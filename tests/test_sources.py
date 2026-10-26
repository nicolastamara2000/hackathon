import asyncio
import sys
import types

from matchcopilot.api import sources
from matchcopilot.generator.engine import generate_match


class _SilentConsumer:
    """Connects but never delivers, like a hub with a wrong name or a missing role."""

    def __init__(self, *args, **kwargs):
        pass

    async def receive(self, on_event, starting_position=None):
        await asyncio.Event().wait()

    async def close(self):
        pass


class _Producer:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def create_batch(self, **kwargs):
        return types.SimpleNamespace(add=lambda e: None)

    async def send_batch(self, batch):
        pass


def test_silent_event_hub_falls_back_to_local_replay(monkeypatch):
    aio = types.ModuleType("azure.eventhub.aio")
    aio.EventHubConsumerClient, aio.EventHubProducerClient = _SilentConsumer, _Producer
    eh = types.ModuleType("azure.eventhub")
    eh.EventData = lambda body: body
    monkeypatch.setitem(sys.modules, "azure.eventhub", eh)
    monkeypatch.setitem(sys.modules, "azure.eventhub.aio", aio)
    monkeypatch.setenv("EVENTHUB_CONNECTION_STRING", "Endpoint=sb://fake/")
    monkeypatch.setenv("EVENTHUB_NAME", "match-events")
    monkeypatch.setattr(sources, "FIRST_EVENT_TIMEOUT_S", 0.2)
    aio.EventHubConsumerClient.from_connection_string = classmethod(lambda cls, *a, **k: cls())
    aio.EventHubProducerClient.from_connection_string = classmethod(lambda cls, *a, **k: cls())

    meta, events = generate_match(7)

    async def collect():
        return [d async for d in sources.event_source(meta.model_dump(), events, 0)]

    out = asyncio.run(asyncio.wait_for(collect(), 30))
    assert len(out) == len(events)


def test_pace_change_applies_mid_replay():
    import asyncio

    pace = sources.Pace(1)
    evs = [{"clock_s": 0, "index": 0}, {"clock_s": 600, "index": 1}]

    async def run():
        out = []
        async def bump():
            await asyncio.sleep(0.05)
            pace.speed = 100000  # 600 match-s now take ~6 ms
        t = asyncio.create_task(bump())
        async for d in sources.replay(evs, pace):
            out.append(d["index"])
        await t
        return out

    assert asyncio.run(asyncio.wait_for(run(), 3)) == [0, 1]
