"""Launcher regression checks; never load a model or change the real setup."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("evidencelens_launch", Path(__file__).with_name("evidencelens_launch.py"))
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)


class EvidenceLensLaunchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "web/dist").mkdir(parents=True)
        (self.root / "web/dist/index.html").write_text('<title>EvidenceLens</title>')
        self.cfg = {"launcher": "/original/c/coli", "engine": "/original/c/qwen36",
                    "model_dir": "/models/existing", "env": {"TUNING": "saved"},
                    "host": "127.0.0.1", "port": 8000,
                    "args": ["web", "--model", "/models/existing", "--host", "127.0.0.1", "--port", "8000"]}
        for target, value in [("ROOT", self.root)]:
            p = patch.object(launch, target, value); p.start(); self.addCleanup(p.stop)
        p = patch.dict(os.environ); p.start(); self.addCleanup(p.stop)
        self.mocks = {}
        for name, kwargs in {
            "load_config": {"return_value": self.cfg},
            "config_ready": {"return_value": True},
            "save_config": {"side_effect": lambda cfg: cfg},
            "server_status": {"return_value": {"state": "stopped"}},
            "port_free": {"return_value": True},
            "start_server": {"return_value": 0},
        }.items():
            p = patch.object(launch.setup_flow, name, **kwargs)
            self.mocks[name] = p.start(); self.addCleanup(p.stop)
        p = patch('sys.stdout', new_callable=io.StringIO); p.start(); self.addCleanup(p.stop)

    def test_uses_checkout_gateway_and_saved_engine_without_modifying_original(self):
        self.assertEqual(launch.main(['--no-browser']), 0)
        cfg = self.mocks['start_server'].call_args.args[0]
        self.assertEqual(cfg['launcher'], str(self.root / 'c/coli'))
        self.assertEqual(cfg['env']['COLI_ENGINE'], '/original/c/qwen36')
        self.assertEqual(cfg['env']['TUNING'], 'saved')
        self.assertEqual(self.cfg['launcher'], '/original/c/coli')
        self.assertNotIn('COLI_ENGINE', self.cfg['env'])
        self.assertFalse(self.mocks['start_server'].call_args.kwargs['open_browser'])
        self.assertEqual(os.environ['COLI_SETUP_HOME'], str(self.root / '.evidencelens'))

    def test_check_never_starts_a_server_and_applies_port_to_ui_and_api(self):
        self.assertEqual(launch.main(['--check', '--port', '8020']), 0)
        self.mocks['start_server'].assert_not_called()
        cfg = self.mocks['save_config'].call_args.args[0]
        self.assertEqual(cfg['port'], 8020)
        self.assertEqual(cfg['args'][-1], '8020')

    def test_does_not_mistake_original_dashboard_for_evidencelens(self):
        self.mocks['server_status'].return_value = {'state': 'ready'}
        with patch.object(launch.urllib.request, 'urlopen') as get:
            get.return_value.__enter__.return_value.read.return_value = b'<title>colibri</title>'
            with self.assertRaisesRegex(launch.setup_flow.SetupError, 'Stop the previous launch'):
                launch.main(['--no-browser'])
        self.mocks['start_server'].assert_not_called()

    def test_reuses_matching_evidencelens_server(self):
        self.mocks['server_status'].return_value = {'state': 'ready'}
        with patch.object(launch.urllib.request, 'urlopen') as get:
            index, capabilities = MagicMock(), MagicMock()
            index.__enter__.return_value.read.return_value = (self.root / 'web/dist/index.html').read_bytes()
            capabilities.__enter__.return_value.read.return_value = '{"service":"evidencelens_documents","version":1}'
            get.side_effect = [index, capabilities]
            self.assertEqual(launch.main(['--no-browser']), 0)
        self.mocks['start_server'].assert_not_called()

    def test_requires_restart_when_existing_server_lacks_python_document_routes(self):
        self.mocks['server_status'].return_value = {'state': 'ready'}
        with patch.object(launch.urllib.request, 'urlopen') as get:
            index = MagicMock()
            index.__enter__.return_value.read.return_value = (self.root / 'web/dist/index.html').read_bytes()
            get.side_effect = [index, OSError('old server')]
            with self.assertRaisesRegex(launch.setup_flow.SetupError, 'older EvidenceLens server'):
                launch.main(['--no-browser'])
        self.mocks['start_server'].assert_not_called()

    def test_refuses_shadowing_dashboard(self):
        shadow = self.root / 'c/web/dist'
        shadow.mkdir(parents=True)
        (shadow / 'index.html').write_text('old dashboard')
        with self.assertRaisesRegex(launch.setup_flow.SetupError, 'shadows'):
            launch.main(['--check'])
        self.mocks['start_server'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
