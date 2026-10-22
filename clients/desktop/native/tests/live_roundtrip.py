#!/usr/bin/env python3
"""Opt-in isolated live server/native queue test. No app installation/deployment."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request

parser=argparse.ArgumentParser()
parser.add_argument('--server',type=Path,required=True)
parser.add_argument('--bytes',type=int,default=32*1024*1024+701)
parser.add_argument('--report',type=Path,required=True)
args=parser.parse_args()
assert 8*1024*1024<args.bytes<=20*1024**3
binary=Path(__file__).resolve().parents[1]/'target/release/examples/live_roundtrip'
assert binary.is_file(), 'cargo build --release --example live_roundtrip first'
with tempfile.TemporaryDirectory(prefix='household-native-live-') as tmp:
    root=Path(tmp)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    origin=f'http://127.0.0.1:{port}'
    server_env=dict(os.environ,HOUSEHOLD_DEV='1',HOUSEHOLD_ADDR=f'127.0.0.1:{port}',HOUSEHOLD_PUBLIC_URL=origin,HOUSEHOLD_TOKEN='native-integration-test-token',HOUSEHOLD_DATA_DIR=str(root/'server'),HOUSEHOLD_MIN_FREE_BYTES='16777216',HOUSEHOLD_WEB_DIR='')
    log=(root/'server.log').open('w+')
    server=None
    def start_server():
        proc=subprocess.Popen([str(args.server.resolve())],env=server_env,stdout=log,stderr=subprocess.STDOUT)
        for _ in range(200):
            if proc.poll() is not None: raise RuntimeError('Server exited; '+(root/'server.log').read_text()[-4000:])
            try:
                with urllib.request.urlopen(origin+'/api/health',timeout=1) as response:
                    if response.status==200:return proc
            except OSError:pass
            time.sleep(.05)
        proc.terminate();proc.wait();raise RuntimeError('Server health timeout')
    server=start_server()
    source=root/'source.bin'
    # Sparse source has deterministic zero bytes. HTTP/server/download still transfer all bytes.
    with source.open('wb') as f:f.truncate(args.bytes)
    env=dict(os.environ,HOUSEHOLD_NATIVE_TEST_ORIGIN=origin,HOUSEHOLD_NATIVE_TEST_TOKEN=server_env['HOUSEHOLD_TOKEN'],HOUSEHOLD_NATIVE_TEST_RESTART_DIR=str(root/'restart'))
    (root/'restart').mkdir()
    begin=time.monotonic();lines=[];restarts=[]
    try:
        native=subprocess.Popen([str(binary),str(source),str(root/'download.bin'),str(root/'queue')],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
        for line in native.stdout:
            print(line,end='',flush=True);lines.append(line.rstrip())
            if line.startswith('REQUEST_SERVER_RESTART '):
                phase=line.split()[1];server.terminate();server.wait(timeout=20);server=start_server();restarts.append(phase);(root/'restart'/f'{phase}.ack').touch()
        _,wait_status,usage=os.wait4(native.pid,0)
        code=os.waitstatus_to_exitcode(wait_status)
        native.returncode=code
        peak=usage.ru_maxrss
        report={'bytes':args.bytes,'exitCode':code,'serverRestarts':restarts,'nativePeakRSSKiB':peak,'elapsedSeconds':round(time.monotonic()-begin,2),'source':'sparse zero-filled local file; all payload bytes transferred via HTTP','output':lines}
        args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2)+'\n')
        assert code==0,report
        assert restarts==['upload','download'],report
        print(json.dumps({k:v for k,v in report.items() if k!='output'}),flush=True)
    finally:
        if server and server.poll() is None:server.terminate();server.wait(timeout=20)
        log.close()
