interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * US health-insurance claim denials and appeal outcomes, by insurer.
 *
 * Answers the two questions people actually ask about their insurance — which
 * companies deny the most claims, and whether appealing one gets anywhere.
 *
 * SOURCE: the CMS Transparency in Coverage Public Use File, plan year 2026,
 * published by the Centers for Medicare & Medicaid Services. Issuers report
 * these figures to CMS themselves under 45 CFR 156.220; CMS publishes the file
 * once a year as an XLSX inside a ZIP. The figures below are that file rolled
 * up to issuer level, with the plan year stated on every response so a caller
 * can never mistake which year they are reading.
 *
 * TWO SCOPE LIMITS, stated up front because both are easy to misread as a data
 * bug and neither is one:
 *
 *  1. HEALTHCARE.GOV STATES ONLY — 30 of them. Issuers on a state-run exchange
 *     (California, New York, Massachusetts, Washington, Colorado, Pennsylvania,
 *     New Jersey and the rest) report to that state, not into this file, so
 *     they are absent. "No data for California" here means this federal file
 *     does not cover it, NOT that California insurers deny nothing.
 *  2. SELF-REPORTED, and CMS says so in the file's own disclaimer. These are
 *     the issuers' own counts, not an audit.
 *
 * The PUF marks a value it cannot publish with `*` (not available for this
 * issuer) or `**` (suppressed). Those become null here, never 0 — a suppressed
 * denial count reported as zero would read as a perfect insurer, which is the
 * worst available lie for this dataset.
 *
 * DEDUPED BY ISSUER, NOT SUMMED, AND ONE RECORD PER ISSUER RATHER THAN PER
 * MARKET. Two distinct traps, both of which produce numbers that look fine:
 *
 *   - The Issuer_* columns repeat identically on every plan row an issuer has,
 *     so summing them multiplies each figure by that issuer's plan count.
 *     Verified: 0 of 185 issuer ids varied across their own rows.
 *   - They are also the issuer's TOTALS, not a per-market slice. An issuer
 *     selling both medical and dental files the same totals in both sheets —
 *     25 of 348 issuer ids do. So `markets` lists which marketplaces an issuer
 *     participates in; it does NOT slice the claims figures, and filtering by
 *     market selects issuers rather than carving up their numbers.
 *
 * REFRESH: annual. `node scripts/refresh-insurance-denials.mjs` regenerates
 * src/data.json from the current CMS file; bump PLAN_YEAR with it.
 */

import raw from './data.json';

interface Issuer {
  issuer_id: string;
  issuer_name: string | null;
  state: string | null;
  markets: string[];
  claims_received_in_network: number | null;
  claims_denied_in_network: number | null;
  claims_received_out_of_network: number | null;
  claims_denied_out_of_network: number | null;
  internal_appeals_filed: number | null;
  internal_appeals_overturned: number | null;
  internal_appeals_percent_overturned: number | null;
  external_appeals_filed: number | null;
  external_appeals_overturned: number | null;
  external_appeals_percent_overturned: number | null;
  denial_rate_in_network_percent: number | null;
  plan_count: number;
}

const DATA = raw as unknown as {
  plan_year: number;
  source: string;
  source_url: string;
  issuers: Issuer[];
};

const ISSUERS = DATA.issuers;
const PLAN_YEAR = DATA.plan_year;
const MARKETS = ['Individual QHP', 'Individual SADP', 'SHOP'] as const;

/** Every response carries these, so a number can never be quoted year-less. */
const PROVENANCE = {
  plan_year: PLAN_YEAR,
  source: DATA.source,
  source_url: DATA.source_url,
  scope:
    'HealthCare.gov (federally-facilitated marketplace) issuers only — 30 states. Issuers on state-run exchanges (CA, NY, MA, WA, CO, PA, NJ and others) report to their state and are not in this federal file.',
  caveat: 'Figures are self-reported by issuers to CMS, not audited. Values CMS suppressed are null, not zero.',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function resolveMarket(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const n = norm(v);
  if (n.includes('sadp') || n.includes('dental')) return 'Individual SADP';
  if (n.includes('shop') || n.includes('smallgroup')) return 'SHOP';
  if (n.includes('qhp') || n.includes('medical') || n.includes('individual')) return 'Individual QHP';
  return null;
}

function pick(i: Issuer) {
  return {
    issuer_name: i.issuer_name,
    issuer_id: i.issuer_id,
    state: i.state,
    markets: i.markets,
    denial_rate_in_network_percent: i.denial_rate_in_network_percent,
    claims_received_in_network: i.claims_received_in_network,
    claims_denied_in_network: i.claims_denied_in_network,
    claims_received_out_of_network: i.claims_received_out_of_network,
    claims_denied_out_of_network: i.claims_denied_out_of_network,
    internal_appeals_filed: i.internal_appeals_filed,
    internal_appeals_overturned: i.internal_appeals_overturned,
    internal_appeals_percent_overturned: i.internal_appeals_percent_overturned,
    external_appeals_filed: i.external_appeals_filed,
    external_appeals_overturned: i.external_appeals_overturned,
    external_appeals_percent_overturned: i.external_appeals_percent_overturned,
    marketplace_plans: i.plan_count,
  };
}

const tools: McpToolExport['tools'] = [
  {
    name: 'insurer_denial_rates',
    description:
      `Which health insurers deny the most claims — US marketplace issuers ranked by the share of in-network claims they denied, for plan year ${PLAN_YEAR}. Answers "what percentage of claims does my insurance company deny", "which insurer denies the most", "how often does <company> deny claims", and comparisons between insurers in a state. Returns each issuer with claims received, claims denied, the denial rate as a percentage, and how many marketplace plans it offers. Filter by state (two-letter code) or by market — medical plans (Individual QHP), standalone dental (Individual SADP, which denies at much higher rates than medical), or small-group SHOP; the market filter selects which ISSUERS to include, since CMS publishes these counts per issuer rather than per market. Sourced from the CMS Transparency in Coverage Public Use File, which insurers report into under federal rule; covers HealthCare.gov states only, so issuers on state-run exchanges such as California and New York are not present.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        state: { type: 'string', description: 'Two-letter US state code to filter by, e.g. "TX", "FL". Omit for all states.' },
        market: { type: 'string', description: 'Restrict to issuers participating in a market: "medical" / "QHP", "dental" / "SADP" for standalone dental, or "SHOP" for small-group. Selects issuers; it does not split an issuer\'s claim counts, which CMS reports per issuer. Omit for all three.' },
        order: { type: 'string', description: '"highest" (default) ranks the biggest deniers first; "lowest" ranks the smallest.' },
        limit: { type: 'number', description: 'How many issuers to return (default 20, max 200).' },
      },
    },
  },
  {
    name: 'insurer_appeal_outcomes',
    description:
      `Does appealing a denied health-insurance claim work? Marketplace issuers ranked by the share of appeals that were OVERTURNED in the patient's favour, plan year ${PLAN_YEAR}. Answers "is it worth appealing a denied claim", "what percentage of insurance appeals succeed", "how often does <company> reverse a denial", and which insurer most often changes its mind. Returns internal appeals (decided by the insurer itself) and external appeals (decided by an independent reviewer) separately, with how many were filed, how many were overturned, and the overturn percentage — the two differ a lot and the external number is the independent one. Sourced from the CMS Transparency in Coverage Public Use File; covers HealthCare.gov states only, so state-run exchanges such as California and New York are not present.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        state: { type: 'string', description: 'Two-letter US state code to filter by, e.g. "TX". Omit for all states.' },
        market: { type: 'string', description: 'Restrict to issuers participating in "medical" / "QHP", "dental" / "SADP", or "SHOP". Selects issuers rather than splitting their figures. Omit for all.' },
        appeal_type: { type: 'string', description: '"internal" (default, decided by the insurer) or "external" (decided by an independent reviewer).' },
        order: { type: 'string', description: '"highest" (default) ranks the most-overturned first; "lowest" ranks the least.' },
        limit: { type: 'number', description: 'How many issuers to return (default 20, max 200).' },
      },
    },
  },
  {
    name: 'insurer_denial_profile',
    description:
      `Everything reported for ONE named health insurer: claims received and denied in and out of network, the denial rate, and both internal and external appeal outcomes, for plan year ${PLAN_YEAR}. Use when a caller names a company — "how often does Ambetter deny claims", "Blue Cross denial rate in Texas", "what happens if I appeal with Oscar". Matches on the insurer's name and is forgiving about punctuation, case and partial names; an issuer selling in several states returns one entry per state, since CMS reports these figures per issuer per state. Sourced from the CMS Transparency in Coverage Public Use File; covers HealthCare.gov states only.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        insurer: { type: 'string', description: 'Insurer name or part of one, e.g. "Ambetter", "Blue Cross Blue Shield of Texas", "oscar".' },
        state: { type: 'string', description: 'Optional two-letter state code to narrow a multi-state insurer, e.g. "TX".' },
      },
      required: ['insurer'],
    },
  },
  {
    name: 'insurer_denial_coverage',
    description:
      `What this data covers before you rely on it: the plan year, how many issuers and states are present, which states are included, and the counts of issuers whose denial or appeal figures CMS suppressed. Use to check whether a state or insurer is in scope at all, and to tell "we hold no data for this state" apart from "this state's insurers deny nothing" — the CMS Transparency in Coverage file covers HealthCare.gov states only.`,
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

function filtered(args: Record<string, unknown>): Issuer[] {
  const st = typeof args.state === 'string' && args.state.trim()
    ? args.state.trim().toUpperCase() : null;
  const mk = resolveMarket(args.market);
  return ISSUERS.filter((i) => (!st || i.state === st) && (!mk || i.markets.includes(mk)));
}

function capped(args: Record<string, unknown>): number {
  const n = typeof args.limit === 'number' ? args.limit : 20;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

/** Sort nulls last regardless of direction — a suppressed value is not a small one. */
function rank<T>(rows: T[], key: (r: T) => number | null, order: unknown): T[] {
  const desc = String(order ?? 'highest').toLowerCase() !== 'lowest';
  return rows
    .filter((r) => key(r) !== null)
    .sort((a, b) => (desc ? (key(b) as number) - (key(a) as number) : (key(a) as number) - (key(b) as number)));
}

function noMatch(args: Record<string, unknown>, what: string) {
  const st = typeof args.state === 'string' ? args.state.trim().toUpperCase() : null;
  const known = [...new Set(ISSUERS.map((i) => i.state).filter(Boolean))].sort();
  const stateIsOutOfScope = st && !known.includes(st);
  return {
    found: false,
    reason: stateIsOutOfScope ? 'state_not_in_source' : 'no_match',
    hint: stateIsOutOfScope
      ? `${st} runs its own health-insurance exchange, so its issuers report there rather than into the federal CMS file this tool reads. States present: ${known.join(', ')}.`
      : `No issuer matched that ${what}. Call insurer_denial_coverage to see which states and markets are present.`,
    ...PROVENANCE,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'insurer_denial_rates': {
      const rows = rank(filtered(args), (i) => i.denial_rate_in_network_percent, args.order);
      if (!rows.length) return noMatch(args, 'filter');
      const limit = capped(args);
      return {
        found: true,
        returned: Math.min(limit, rows.length),
        total_matching: rows.length,
        ranked_by: 'in-network claim denial rate (%)',
        issuers: rows.slice(0, limit).map(pick),
        ...PROVENANCE,
      };
    }

    case 'insurer_appeal_outcomes': {
      const external = String(args.appeal_type ?? 'internal').toLowerCase().startsWith('ext');
      const key = (i: Issuer) => (external
        ? i.external_appeals_percent_overturned
        : i.internal_appeals_percent_overturned);
      const rows = rank(filtered(args), key, args.order);
      if (!rows.length) return noMatch(args, 'filter');
      const limit = capped(args);
      return {
        found: true,
        returned: Math.min(limit, rows.length),
        total_matching: rows.length,
        appeal_type: external ? 'external (independent reviewer)' : 'internal (decided by the insurer)',
        ranked_by: 'percent of appeals overturned in the patient\'s favour',
        issuers: rows.slice(0, limit).map(pick),
        ...PROVENANCE,
      };
    }

    case 'insurer_denial_profile': {
      const q = typeof args.insurer === 'string' ? norm(args.insurer) : '';
      if (!q) return noMatch(args, 'insurer name');
      const st = typeof args.state === 'string' && args.state.trim()
        ? args.state.trim().toUpperCase() : null;
      let rows = ISSUERS.filter((i) =>
        i.issuer_name && norm(i.issuer_name).includes(q) && (!st || i.state === st));
      if (!rows.length) return noMatch(args, 'insurer name');
      rows = rows.sort((a, b) => (a.state ?? '').localeCompare(b.state ?? ''));
      return {
        found: true,
        matched: rows.length,
        note: rows.length > 1
          ? 'This insurer reports separately per state and market; each entry below is one such filing.'
          : undefined,
        issuers: rows.map(pick),
        ...PROVENANCE,
      };
    }

    case 'insurer_denial_coverage': {
      const states = [...new Set(ISSUERS.map((i) => i.state).filter(Boolean))].sort();
      return {
        found: true,
        issuer_filings: ISSUERS.length,
        distinct_issuer_ids: new Set(ISSUERS.map((i) => i.issuer_id)).size,
        states_covered: states.length,
        states: states,
        by_market: MARKETS.map((m) => {
          const sub = ISSUERS.filter((i) => i.markets.includes(m));
          return {
            market: m,
            issuers: sub.length,
            with_denial_rate: sub.filter((i) => i.denial_rate_in_network_percent !== null).length,
            with_internal_appeal_rate: sub.filter((i) => i.internal_appeals_percent_overturned !== null).length,
          };
        }),
        suppressed_note:
          'CMS marks figures it cannot publish with * or **; those are null here rather than 0, so an issuer with a null denial rate is unreported, not perfect.',
        ...PROVENANCE,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
