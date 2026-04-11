"""CLI commands for the DKG memory plugin.

Provides `hermes dkg status`, `hermes dkg query`, and `hermes dkg sync`
for debugging and manual operations.
"""

from __future__ import annotations

import json
import sys


def register_cli(cli_group):
    """Register DKG CLI commands with the Hermes CLI."""

    import click

    @cli_group.group("dkg")
    def dkg():
        """DKG node commands — status, query, sync."""
        pass

    @dkg.command("status")
    def dkg_status():
        """Show DKG node connection, context graphs, and assertion stats."""
        from plugins.memory.dkg.client import DKGClient
        from plugins.memory.dkg import _load_config, _load_cache

        config = _load_config()
        client = DKGClient(base_url=config.get("daemon_url", "http://127.0.0.1:9200"))

        if not client.health_check():
            cache = _load_cache()
            click.echo("DKG Status: OFFLINE")
            click.echo(f"  Daemon URL: {config.get('daemon_url')}")
            click.echo(f"  Cached memory entries: {len(cache.get('memory', []))}")
            click.echo(f"  Cached user entries: {len(cache.get('user', []))}")
            click.echo(f"  Queued writes: {len(cache.get('queued_writes', []))}")
            return

        status = client.status()
        cg_list = client.list_context_graphs()

        click.echo("DKG Status: CONNECTED")
        click.echo(f"  Daemon URL: {config.get('daemon_url')}")
        click.echo(f"  Peer ID: {status.get('peerId', 'unknown')}")
        click.echo(f"  Context Graph: {config.get('context_graph', 'hermes-memory')}")
        if isinstance(cg_list, list):
            click.echo(f"  Subscribed CGs: {len(cg_list)}")
            for cg in cg_list[:5]:
                name = cg.get("name", cg.get("id", "?"))
                click.echo(f"    - {name}")
        client.close()

    @dkg.command("query")
    @click.argument("sparql")
    def dkg_query(sparql):
        """Run a SPARQL query against the DKG node."""
        from plugins.memory.dkg.client import DKGClient
        from plugins.memory.dkg import _load_config

        config = _load_config()
        client = DKGClient(base_url=config.get("daemon_url", "http://127.0.0.1:9200"))

        if not client.health_check():
            click.echo("Error: DKG daemon is not reachable.", err=True)
            sys.exit(1)

        result = client.query(sparql, config.get("context_graph"))
        click.echo(json.dumps(result, indent=2))
        client.close()

    @dkg.command("sync")
    def dkg_sync():
        """Force-sync local cache to DKG (useful after offline period)."""
        from plugins.memory.dkg.client import DKGClient
        from plugins.memory.dkg import _load_config, _load_cache, _save_cache

        config = _load_config()
        client = DKGClient(base_url=config.get("daemon_url", "http://127.0.0.1:9200"))

        if not client.health_check():
            click.echo("Error: DKG daemon is not reachable.", err=True)
            sys.exit(1)

        cache = _load_cache()
        queued = cache.get("queued_writes", [])
        if not queued:
            click.echo("Nothing to sync — no queued writes.")
            return

        click.echo(f"Syncing {len(queued)} queued writes...")
        synced = 0
        for item in queued:
            try:
                if item.get("type") == "turn":
                    client.store_turn(
                        item["session_id"],
                        item.get("user", ""),
                        item.get("assistant", ""),
                    )
                    synced += 1
            except Exception as e:
                click.echo(f"  Failed: {e}")

        cache["queued_writes"] = []
        _save_cache(cache)
        click.echo(f"Synced {synced}/{len(queued)} writes.")
        client.close()
