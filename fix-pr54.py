#!/usr/bin/env python3
"""Fix PR #54 - consensus attestation triples."""
import subprocess, sys, os

os.chdir('/Users/aleatoric/dev/dkg-v9')

def run(cmd, check=True):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and r.returncode != 0:
        print(f"FAILED: {cmd}\n{r.stdout}\n{r.stderr}")
        sys.exit(1)
    return r

run("rm -f .git/index.lock")
run("git checkout -f feat/v1-consensus-attestation-triples")
print("On branch:", run("git branch --show-current").stdout.strip())

# --- Fix 1: Store approval timestamps (coordinator.ts) ---
with open('packages/origin-trail-game/src/dkg/coordinator.ts', 'r') as f:
    content = f.read()

# Add approvalTimestamps to TurnProposal interface
content = content.replace(
    '  approvals: Set<string>;',
    '  approvals: Set<string>;\n  approvalTimestamps: Map<string, number>;'
)

# Initialize approvalTimestamps when leader creates proposal
content = content.replace(
    '      approvals: new Set([this.myPeerId]),\n      votes,\n      resolution,\n      deaths,\n      event: turnEvent,',
    '      approvals: new Set([this.myPeerId]),\n      approvalTimestamps: new Map([[this.myPeerId, Date.now()]]),\n      votes,\n      resolution,\n      deaths,\n      event: turnEvent,'
)

# Initialize approvalTimestamps when follower receives remote proposal
content = content.replace(
    '      approvals: new Set([msg.peerId, this.myPeerId]),\n      votes,\n      resolution,\n      deaths,\n      event: msg.event,',
    '      approvals: new Set([msg.peerId, this.myPeerId]),\n      approvalTimestamps: new Map([[msg.peerId, msg.timestamp], [this.myPeerId, Date.now()]]),\n      votes,\n      resolution,\n      deaths,\n      event: msg.event,'
)

# Store timestamp when remote approval is received
content = content.replace(
    '    swarm.pendingProposal.approvals.add(msg.peerId);',
    '    swarm.pendingProposal.approvals.add(msg.peerId);\n    swarm.pendingProposal.approvalTimestamps.set(msg.peerId, msg.timestamp ?? Date.now());'
)

# Use stored timestamps when building attestations in checkProposalThreshold
content = content.replace(
    '''        const attestations: rdf.ConsensusAttestation[] = [...proposal.approvals].map(pid => ({
          peerId: pid,
          proposalHash: proposal.hash,
          approved: true,
          timestamp: Date.now(),
        }));''',
    '''        const attestations: rdf.ConsensusAttestation[] = [...proposal.approvals].map(pid => ({
          peerId: pid,
          proposalHash: proposal.hash,
          approved: true,
          timestamp: proposal.approvalTimestamps.get(pid) ?? Date.now(),
        }));'''
)

with open('packages/origin-trail-game/src/dkg/coordinator.ts', 'w') as f:
    f.write(content)
print("Fixed coordinator.ts")

# --- Fix 2: Include proposalHash in attestation URI (rdf.ts) ---
with open('packages/origin-trail-game/src/dkg/rdf.ts', 'r') as f:
    content = f.read()

content = content.replace(
    "const attUri = otUri(`swarm/${swarmId}/turn/${turn}/attestation/${att.peerId}`);",
    "const attUri = otUri(`swarm/${swarmId}/turn/${turn}/attestation/${att.peerId}/${att.proposalHash.slice(0, 8)}`);"
)

with open('packages/origin-trail-game/src/dkg/rdf.ts', 'w') as f:
    f.write(content)
print("Fixed rdf.ts")

# Verify
print("\nVerifying changes:")
r = run("git diff --stat")
print(r.stdout)
r = run("git diff")
print(r.stdout[:3000])

# Run tests
print("\nRunning tests...")
r = run("pnpm --filter dkg-app-origin-trail-game test", check=False)
last = r.stdout[-2000:] if len(r.stdout) > 2000 else r.stdout
print(last)
if r.returncode != 0:
    print("STDERR:", r.stderr[-1000:])
    sys.exit(1)
print("Tests passed!")

# Commit and push
run("git add -A")
run('git commit -m "fix: store approval timestamps at receive-time and include proposalHash in attestation URI\n\nFix 1: Track per-peer approval timestamps in approvalTimestamps Map\nrather than using leader-local Date.now() at publish time.\n\nFix 2: Include proposalHash prefix in attestation URI so retries\nfrom the same peer do not collide."')
r = run("git push origin feat/v1-consensus-attestation-triples")
print("Pushed!", r.stdout, r.stderr)
