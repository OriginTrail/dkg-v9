# @dkg/sdk

Resource-first TypeScript SDK for DKG daemon APIs.

## Quick Start

```ts
import { createDKG } from '@dkg/sdk';

const dkg = createDKG({
  baseUrl: 'http://127.0.0.1:9200',
  token: process.env.DKG_TOKEN,
});

const status = await dkg.node.status();
console.log(status.peerId);

const paranets = await dkg.paranet.list();
console.log(paranets.paranets.length);

const published = await dkg.publish.quads({
  paranetId: 'dev-coordination',
  quads: [
    {
      subject: 'urn:entity:test',
      predicate: 'http://schema.org/name',
      object: '"SDK test"',
      graph: 'did:dkg:paranet:dev-coordination',
    },
  ],
});
console.log(published.kcId);

const rows = await dkg.query.sparql('SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10', {
  paranetId: 'dev-coordination',
});
console.log(rows.result);

const discovered = await dkg.agent.list({ framework: 'OpenClaw' });
console.log(discovered.agents.map((a) => a.name));
```

## Current Resources

- `dkg.node.status()`
- `dkg.paranet.list()`
- `dkg.paranet.create({ id, name, description? })`
- `dkg.paranet.exists(id)`
- `dkg.paranet.subscribe(paranetId, { includeWorkspace? })`
- `dkg.paranet.catchupStatus(paranetId)`
- `dkg.publish.quads({ paranetId, quads, privateQuads?, accessPolicy?, allowedPeers? })`
- `dkg.publish.workspaceWrite({ paranetId, quads })`
- `dkg.publish.workspaceEnshrine({ paranetId, selection?, clearAfter? })`
- `dkg.query.sparql(sparql, { paranetId? })`
- `dkg.query.remote({ peerId, lookupType, ... })`
- `dkg.agent.list({ framework?, skillType? })`
- `dkg.agent.skills({ skillType? })`
- `dkg.agent.invokeSkill({ peerId, skillUri, input? })`
- `dkg.agent.chat({ to, text })`
- `dkg.agent.messages({ peer?, since?, limit? })`

This is the initial SDK foundation; next step is expanding each resource with additional typed operations.
