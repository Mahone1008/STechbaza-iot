"""CI-only simulated edge on a real TLS bridge. Never run against an attached VFD."""
import json
import os
from pathlib import Path
import queue
import ssl
import threading
import time
import uuid
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from app.bench.su600 import DEVICE_ID, UID, prepare
from app.demo.check import Client, ensure, wait_for
from app.demo.seed import assert_database
from app.db import SessionLocal
from app.schemas.command import CommandEnvelope


def run():
    if os.getenv("TECHBAZA_V3_ACCEPTANCE") != "1":
        raise RuntimeError("CI-only V3 acceptance requires an isolated broker with no physical controller")
    with SessionLocal() as session:
        assert_database(session)
    identity = json.loads(Path("/work/identity.json").read_text())
    ensure(identity["uid"] == UID, "Wrong identity")
    topic = f"techbaza/devices/{UID}"
    inbox = queue.Queue()
    connected = threading.Event()
    connection = []

    def create(password, *, username=UID):
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="v3-ci-"+uuid.uuid4().hex, clean_session=True)
        client.tls_set(ca_certs="/work/ca.crt", tls_version=ssl.PROTOCOL_TLS_CLIENT)
        if username is not None:
            client.username_pw_set(username, password)
        return client

    # Certificate verification must work without hostname/CA bypasses.
    tls = ssl.create_default_context(cafile="/work/ca.crt")
    import socket
    with socket.create_connection((identity["host"],8883),timeout=5) as sock:
        with tls.wrap_socket(sock,server_hostname=identity["host"]) as secured:
            ensure(secured.version() in {"TLSv1.2", "TLSv1.3"}, "TLS version")
    try:
        with socket.create_connection((identity["host"],8883),timeout=5) as sock:
            ssl.create_default_context().wrap_socket(sock,server_hostname=identity["host"])
    except ssl.SSLCertVerificationError:
        pass
    else:
        raise RuntimeError("Private CA unexpectedly trusted without pairing")
    for username,password in ((None,None),(UID,"wrong-password")):
        ready=threading.Event(); outcome=[]
        denied=create(password,username=username)
        denied.on_connect=lambda client,userdata,flags,reason,props: (outcome.append(reason.is_failure),ready.set())
        denied.connect(identity["host"],8883,10);denied.loop_start()
        try:
            ensure(ready.wait(5) and outcome==[True], "Anonymous/wrong password must be rejected")
        finally:
            denied.disconnect();denied.loop_stop()

    edge=create(identity["password"])
    edge.on_connect=lambda client,userdata,flags,reason,props: (connection.append(not reason.is_failure),connected.set())
    edge.on_message=lambda client,userdata,message: inbox.put((message.topic,bytes(message.payload)))
    edge.connect(identity["host"],8883,10);edge.loop_start()
    owner=None
    try:
        ensure(connected.wait(5) and connection==[True], "Device MQTT authentication")
        subscribed=threading.Event()
        edge.on_subscribe=lambda *args: subscribed.set()
        edge.subscribe(topic+"/commands",qos=1);ensure(subscribed.wait(5), "Command subscription")
        boot=str(uuid.uuid4())
        def envelope(sequence):
            return {"schema_version":1,"message_id":str(uuid.uuid4()),"session_id":boot,
                    "sequence":sequence,"sent_at":datetime.now(timezone.utc).isoformat()}
        def publish(suffix,payload):
            info=edge.publish(topic+suffix,json.dumps(payload),qos=1,retain=False)
            info.wait_for_publish(timeout=5);ensure(info.is_published(), "MQTT PUBACK")
        publish("/heartbeat",envelope(0))
        diagnostics={"version":1,"firmware_version":"0.2.2","uptime_ms":3000,"reset_reason":"power_on",
                     "connection":{"transport":"wifi","signal":{"metric":"rssi","dbm":-67}},"last_stop":None}
        publish("/telemetry",{**envelope(1),"values":{"vfd.frequency_hz":0,"vfd.set_frequency_hz":19,
            "vfd.current_a":0,"vfd.voltage_v":0},"state":{"pump_running":False,"vfd_fault_code":0,
            "vfd_link":True,"vfd_configuration_valid":True,"control_armed":False},"diagnostics":diagnostics})
        owner=Client("owner")
        path=f"/api/v1/devices/{DEVICE_ID}"
        def fresh_view():
            result=owner.call("GET",path+"/overview")
            return result if result["telemetry_freshness"]["status"]=="fresh" else None
        view=wait_for("V3 TLS telemetry",fresh_view)
        ensure(view["device"]["uid"]==UID and view["availability"]["online"], "Physical identity/presence")
        ensure(view["diagnostics"]=={**diagnostics, "program": None}, "Typed controller diagnostics over MQTT/TLS to overview")
        ensure(not view["allowed_commands"], "Read-only enrollment must have no command capability")
        ensure("emergency_stop" not in view["state_keys"] and "local_mode" not in view["state_keys"], "Uninstalled inputs leaked")
        ensure("pressure.bar" not in view["value_keys"], "Uninstalled pressure sensor")
        metrics={item["key"]:item["value"] for item in view["readings"]}
        ensure(metrics["vfd.set_frequency_hz"]==19 and metrics["vfd.voltage_v"]==0, "Scaling/zero readings lost")
        owner.call("POST",path+"/commands",{"request_id":str(uuid.uuid4()),"command_type":"vfd.start"},expected=409)

        # A client that may read commands must not be able to publish them to itself.
        probe=("ACL-PROBE-"+uuid.uuid4().hex).encode()
        info=edge.publish(topic+"/commands",probe,qos=1);info.wait_for_publish(timeout=5)
        try:
            message=inbox.get(timeout=1)
        except queue.Empty:
            pass
        else:
            ensure(message[1]!=probe,"Device was allowed to publish its own command")

        prepare(enable_control=True)
        publish("/heartbeat",envelope(2))
        command=owner.call("POST",path+"/commands",{"request_id":str(uuid.uuid4()),"command_type":"vfd.stop"},expected=201)
        message=inbox.get(timeout=15); raw=json.loads(message[1]); parsed=CommandEnvelope.model_validate(raw)
        ensure(parsed.schema_version==2 and str(parsed.command_id)==command["id"],"Command bridge/v2 contract")
        # This CI peer verifies transport only; physical verification is tested by the C++ core suite and the user's bench.
        reply={"schema_version":1,"message_id":str(uuid.uuid4()),"session_id":boot,"command_id":command["id"],
               "sent_at":datetime.now(timezone.utc).isoformat()}
        publish("/commands/ack",reply)
        publish("/commands/result",{**reply,"message_id":str(uuid.uuid4()),"status":"succeeded",
                                    "result":{"frequency_hz":0},"error_code":None,"error_message":None})
        wait_for("V3 result bridge",lambda: owner.call("GET","/api/v1/commands/"+command["id"])["status"]=="succeeded")
        publish("/telemetry",{**envelope(3),"values":{},"state":{"vfd_link":False,"vfd_configuration_valid":False,"control_armed":False}})
        def missing_view():
            result=owner.call("GET",path+"/overview")
            return result if all(item["value"] is None for item in result["readings"]) else None
        view=wait_for("VFD absent fields",missing_view)
        ensure(view["availability"]["online"],"VFD outage should not masquerade as ESP32 outage")
        print("PASS: TLS CA/IP, anonymous/password rejection, topic ACL, read-only enrollment, telemetry/subsets, v2 command/ACK/result bridge and missing values")
    finally:
        prepare(enable_control=False)
        edge.disconnect();edge.loop_stop()
        if owner:owner.logout()


if __name__ == "__main__":
    run()
