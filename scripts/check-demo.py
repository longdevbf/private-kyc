"""Read the running demo's public state and report the linkage result."""
import json, urllib.request
d = json.load(urllib.request.urlopen("http://localhost:4000/api/state"))
ns = [p["nullifier"] for p in d["presentations"] if p["accepted"]]
print("accepted presentations:", len(ns))
if len(ns) >= 2:
    a = [ns[0][i:i+2] for i in range(0, 64, 2)]
    b = [ns[1][i:i+2] for i in range(0, 64, 2)]
    print("bytes in common:", sum(1 for x, y in zip(a, b) if x == y), "of 32")
print("epoch:", d["public"]["revocationEpoch"],
      "| leaves:", d["public"]["nextLeafIndex"],
      "| issuers:", d["public"]["issuers"])
