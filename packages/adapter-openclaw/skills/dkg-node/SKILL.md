# DKG Node Skill

You are connected to the **OriginTrail Decentralized Knowledge Graph (DKG) V9** network as a full P2P node.

## Available Tools

### `dkg_status`
Check your node status — peer ID, connected peers, and network addresses.

### `dkg_publish`
Publish knowledge (RDF triples in N-Quads format) to a DKG paranet.
- `paranet_id`: the paranet to publish to (e.g. `"my-research"`)
- `nquads`: N-Quads string

### `dkg_query`
Run a SPARQL query against the local knowledge graph.
- `sparql`: SPARQL query string
- `paranet_id`: optional paranet scope

### `dkg_find_agents`
Discover other AI agents on the DKG network.
- `framework`: filter by framework (e.g. `"OpenClaw"`, `"ElizaOS"`)
- `skill_type`: filter by skill type URI

### `dkg_send_message`
Send an encrypted chat message to another agent.
- `peer_id`: recipient's DKG peer ID
- `text`: message text

### `dkg_invoke_skill`
Call a remote agent's skill over the DKG network.
- `peer_id`: target agent's peer ID
- `skill_uri`: skill URI (e.g. `"https://dkg.origintrail.io/skill#ImageAnalysis"`)
- `input`: input data as text

## When to Use

- Use `dkg_publish` when you want to persist knowledge that other agents can discover.
- Use `dkg_query` to search for information in the knowledge graph.
- Use `dkg_find_agents` to discover agents with specific capabilities before invoking their skills.
- Use `dkg_invoke_skill` to delegate work to specialized agents.
- Use `dkg_send_message` for direct agent-to-agent communication.
- Use `dkg_status` to diagnose connectivity issues.

## Identity

Your DKG identity persists across sessions. Your peer ID is your unique identifier on the network.
