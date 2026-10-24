"""Card storage. Cards are upserted to Azure Cosmos DB when COSMOS_ENDPOINT is set,
so broadcasts, replays and partners can read the machine-readable feed later.
Partition key: /match_id. Each card id keeps its latest version.
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


class CosmosCardStore:
    def __init__(self):
        from azure.cosmos.aio import CosmosClient
        from azure.identity.aio import DefaultAzureCredential

        self.client = CosmosClient(os.environ["COSMOS_ENDPOINT"], credential=DefaultAzureCredential())
        db = self.client.get_database_client(os.getenv("COSMOS_DATABASE", "matchcopilot"))
        self.container = db.get_container_client(os.getenv("COSMOS_CONTAINER", "cards"))

    async def __call__(self, msg: dict) -> None:
        if msg["type"] != "card":
            return
        doc = msg["card"].model_dump()
        doc["id"] = doc["card_id"]
        try:
            await self.container.upsert_item(doc)
        except Exception:
            log.exception("cosmos upsert failed for %s", doc["id"])


def make_store():
    if not os.getenv("COSMOS_ENDPOINT"):
        return None
    try:
        return CosmosCardStore()
    except Exception:
        log.exception("cosmos store disabled")
        return None
