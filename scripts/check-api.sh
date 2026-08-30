#!/usr/bin/env bash
curl -s http://localhost:4000/api/state > /tmp/state.json
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/state.json","utf8"));
console.log("top-level keys:", Object.keys(j).join(", "));
console.log("engine       :", JSON.stringify(j.engine));
console.log("deployments  :", Array.isArray(j.deployments) ? j.deployments.length : "MISSING");
'
