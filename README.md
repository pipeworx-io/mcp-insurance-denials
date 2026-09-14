# insurance-denials

US health-insurance claim denial rates and appeal outcomes, per insurer — which
companies deny the most claims, and whether appealing one actually works.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1573+ live data sources.

## Tools

| Tool | Answers |
|---|---|
| `insurer_denial_rates` | Which insurers deny the most claims, ranked by in-network denial rate. Filter by state and market. |
| `insurer_appeal_outcomes` | What share of appeals get overturned in the patient's favour, internal *and* external. |
| `insurer_denial_profile` | Everything reported for one named insurer, forgiving about how the name is written. |
| `insurer_denial_coverage` | What is in scope — plan year, issuer and state counts, and how much CMS suppressed. |

## Auth

None. No key, no account.

## Data sources

The **CMS Transparency in Coverage Public Use File**, plan year 2026, published
by the Centers for Medicare & Medicaid Services:

- Landing page: <https://www.cms.gov/marketplace/resources/data/public-use-files>
- File: <https://download.cms.gov/marketplace-puf/2026/transparency-in-coverage-puf.zip>

Issuers report these figures to CMS themselves under 45 CFR 156.220. CMS
publishes the file once a year, as an XLSX inside a ZIP.

## What this covers, and what it does not

Two limits, both easy to mistake for a data bug:

**HealthCare.gov states only — 30 of them.** An issuer on a state-run exchange
(California, New York, Massachusetts, Washington, Colorado, Pennsylvania, New
Jersey and others) reports to that state, not into this federal file. A caller
asking about California gets an explicit `state_not_in_source` refusal naming
the reason, rather than an empty list that would read as "California insurers
deny nothing".

**Self-reported.** These are the issuers' own counts, and CMS says so in the
file's own disclaimer. They are not an audit.

## Reading the numbers

- **Dental denies far more than medical.** Standalone dental plans
  (`Individual SADP`) sit at the top of any unfiltered denial ranking — several
  above 70%. Pass `market: "medical"` when the question is about medical cover,
  or the answer will be true and misleading.
- **Suppressed is not zero.** CMS marks a figure it cannot publish with `*` or
  `**`. Those are `null` here, never `0` — a suppressed denial count reported as
  zero would describe a perfect insurer.
- **Internal and external appeals differ.** Internal appeals are decided by the
  insurer that issued the denial; external appeals go to an independent
  reviewer. The external number is the arm's-length one.
- **One filing per state.** A multi-state insurer reports separately in each
  state, so `insurer_denial_profile` returns one entry per state rather than a
  single national figure.
- **`markets` is a scope label, not a slice.** CMS publishes these counts per
  ISSUER, not per market, and an issuer selling both medical and dental files
  the same totals in both sheets (25 of 348 do). So `markets` lists which
  marketplaces an issuer participates in, and filtering by market chooses which
  issuers to include — it does not carve up their claim counts.

## Refreshing

Annual, when CMS publishes the next plan year:

```bash
node scripts/refresh-insurance-denials.mjs   # rewrites src/data.json
```

The script re-reads the CMS file and rolls it up to issuer level. It **dedupes
by issuer id and never sums**: the `Issuer_*` columns repeat identically on
every plan row an issuer has, so summing multiplies each figure by that
issuer's plan count. Verified when the pack was built — 0 of 185 issuer ids
varied across their own rows. It also emits **one record per issuer**, merging
the market sheets an issuer appears in, for the same reason: those rows carry
identical totals, and one row per sheet duplicated 25 issuers in every ranking.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "insurance-denials": {
      "url": "https://gateway.pipeworx.io/insurance-denials/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/insurance-denials/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1573+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "insurance-denials": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-insurance-denials"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-insurance-denials
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Insurance Denials data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
