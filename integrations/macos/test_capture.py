#!/usr/bin/env python3
"""Check shell argument integrity and streamed text without a macOS dependency."""
from pathlib import Path
import json
import os
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp)
    helper=root/'helper with spaces'
    helper.write_text('#!/usr/bin/env python3\nimport os,sys,json\nfrom pathlib import Path\nPath(os.environ["CAPTURE_RESULT"]).write_text(json.dumps({"args":sys.argv[1:],"stdin":sys.stdin.read()}))\n')
    helper.chmod(0o700)
    result=root/'result.json'
    env=dict(os.environ,HOUSEHOLD_CLI=str(helper),CAPTURE_RESULT=str(result))
    paths=['/tmp/spaces 🏠.txt','/tmp/folder 家','/tmp/$(touch SHOULD_NOT_EXIST); `echo no`','/tmp/new\nline','-option-like']
    subprocess.run(['bash',str(HERE/'send-files.sh'),*paths],env=env,input=b'',check=True)
    assert json.loads(result.read_text())=={'args':['enqueue',*paths],'stdin':''}
    text='  full text\nUnicode: 家 🏠\n$() `touch no`\n'*5000
    subprocess.run(['bash',str(HERE/'send-text.sh')],env=env,input=text.encode(),check=True)
    assert json.loads(result.read_text())=={'args':['text'],'stdin':text}
    assert subprocess.run(['bash',str(HERE/'send-files.sh')],env=env,capture_output=True).returncode!=0
print('Capture scripts: exact arguments and streamed UTF-8 stdin passed.')
