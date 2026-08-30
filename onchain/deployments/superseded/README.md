# Superseded deployments

Contracts that were deployed and then replaced. They are still on chain and
still addressable; they are simply no longer what this repo points at.

Kept because deleting the record of a deployment would make the history
less honest, not tidier — and moved out of the parent directory because the
web UI treats every `deployments/*.json` as a live deployment.

## preview-2026-08-30T13-25.json

The first deployment of the port, and the one that proved the pipeline
worked end to end: `registerIssuer`, `issueCredential` and `present` all
executed against it on preview.

Replaced because it was compiled when this repo still believed block time
was in milliseconds. Its `freshnessWindow()` returns `300000`, which the
chain reads as 300,000 **seconds** — about three and a half days, where the
design calls for five minutes. See RESEARCH.md §H.11.
