"""Where live events come from.

Local mode replays a generated match at match-clock speed / `speed`. When
EVENTHUB_NAMESPACE (or EVENTHUB_CONNECTION_STRING) and EVENTHUB_NAME are set, the
same replay is published to Azure Event Hubs and the session consumes it back
from the hub, so the production path is event-driven end to end.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator

log = logging.getLogger(__name__)


async def replay(events, speed: float) -> AsyncIterator[dict]:
    prev = None
    for e in events:
        d = e.model_dump(exclude_none=True) if hasattr(e, "model_dump") else e
        if prev is not None and speed > 0:
            await asyncio.sleep(max(0.0, (d["clock_s"] - prev) / speed))
        else:
            await asyncio.sleep(0)  # still yield to the loop so viewers get served
        prev = d["clock_s"]
        yield d


def eventhub_enabled() -> bool:
    return bool(os.getenv("EVENTHUB_NAME") and (os.getenv("EVENTHUB_NAMESPACE")
                                                 or os.getenv("EVENTHUB_CONNECTION_STRING")))


async def _eventhub_roundtrip(meta: dict, events, speed: float) -> AsyncIterator[dict]:
    from azure.eventhub import EventData
    from azure.eventhub.aio import EventHubConsumerClient, EventHubProducerClient

    name = os.environ["EVENTHUB_NAME"]
    conn = os.getenv("EVENTHUB_CONNECTION_STRING")
    if conn:
        producer = EventHubProducerClient.from_connection_string(conn, eventhub_name=name)
        consumer = EventHubConsumerClient.from_connection_string(conn, "$Default", eventhub_name=name)
    else:
        from azure.identity.aio import DefaultAzureCredential
        cred = DefaultAzureCredential()
        ns = os.environ["EVENTHUB_NAMESPACE"]
        producer = EventHubProducerClient(ns, name, cred)
        consumer = EventHubConsumerClient(ns, "$Default", name, cred)

    match_id = meta["match_id"]
    queue: asyncio.Queue = asyncio.Queue()
    last_index = None

    async def on_event(partition_context, event):
        if event is None:
            return
        d = json.loads(event.body_as_str())
        if d.get("match_id") == match_id:
            await queue.put(d)

    async def publish():
        nonlocal last_index
        async with producer:
            async for d in replay(events, speed):
                batch = await producer.create_batch(partition_key=match_id)
                batch.add(EventData(json.dumps(d)))
                await producer.send_batch(batch)
                last_index = d["index"]

    consume = asyncio.create_task(consumer.receive(on_event=on_event, starting_position="@latest"))
    await asyncio.sleep(2)  # let the consumer attach before the first event
    pub = asyncio.create_task(publish())
    try:
        while True:
            d = await queue.get()
            yield d
            if pub.done() and last_index is not None and d["index"] >= last_index:
                break
    finally:
        consume.cancel()
        await consumer.close()


async def event_source(meta: dict, events, speed: float) -> AsyncIterator[dict]:
    done = -1
    if eventhub_enabled():
        try:
            async for d in _eventhub_roundtrip(meta, events, speed):
                done = d["index"]
                yield d
            return
        except Exception:
            log.exception("Event Hubs unavailable, continuing with local replay")
    async for d in replay(events[done + 1:], speed):  # resume where the hub stopped
        yield d
