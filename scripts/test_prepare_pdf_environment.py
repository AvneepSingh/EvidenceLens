import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import venv

spec=importlib.util.spec_from_file_location('pdf_environment',Path(__file__).with_name('prepare_pdf_environment.py'))
env=importlib.util.module_from_spec(spec);spec.loader.exec_module(env)


class EnvironmentTests(unittest.TestCase):
    def test_pip_present_requires_no_changes(self):
        with patch.object(env,'probe',return_value=True),patch.object(env,'install') as install:
            env.bootstrap_pip('base','target');install.assert_not_called()

    def test_uses_ensurepip_when_available(self):
        with patch.object(env,'probe',side_effect=[False,True]) as probe,patch.object(env,'install') as install:
            env.bootstrap_pip('base','target')
            self.assertEqual(probe.call_args.args[0],['target','-m','ensurepip','--upgrade'])
            install.assert_not_called()

    def test_colab_without_ensurepip_bootstraps_with_base_pip(self):
        with patch.object(env,'probe',side_effect=[False,False,True,True]),patch.object(env,'install') as install:
            env.bootstrap_pip('base','target')
            install.assert_called_once_with(['base','-m','pip','--python','target','install','pip'])

    def test_no_install_when_base_environment_already_has_pdf_packages(self):
        with tempfile.TemporaryDirectory() as root,patch.object(env,'probe',return_value=True),patch.object(env,'install') as install:
            self.assertEqual(env.prepare(root,'base'),'base');install.assert_not_called()

    def test_new_venv_is_created_without_assuming_ensurepip(self):
        with tempfile.TemporaryDirectory() as root:
            target=str(Path(root).resolve()/'.evidencelens/venv/bin/python')
            with patch.object(env,'probe',side_effect=[False,False,False,True]),patch.object(env,'bootstrap_pip') as boot,patch.object(env,'install') as install:
                self.assertEqual(env.prepare(root,'base'),target)
                self.assertEqual(install.call_args_list[0].args[0],['base','-m','venv','--without-pip',str(Path(root).resolve()/'.evidencelens/venv')])
                boot.assert_called_once_with('base',target)

    def test_incomplete_environment_is_preserved_before_recreation(self):
        with tempfile.TemporaryDirectory() as root:
            original=Path(root)/'.evidencelens/venv';original.mkdir(parents=True);(original/'keep.txt').write_text('old setup')
            with patch.object(env,'probe',side_effect=[False,False,True]),patch.object(env,'install'):
                env.prepare(root,'base')
            backups=list(original.parent.glob('venv.incomplete.*'))
            self.assertEqual(len(backups),1);self.assertEqual((backups[0]/'keep.txt').read_text(),'old setup')

    def test_real_pipless_virtualenv_is_repaired(self):
        with tempfile.TemporaryDirectory() as root:
            target=Path(root)/'venv'
            venv.EnvBuilder(with_pip=False).create(target)
            python=str(target/'bin/python')
            self.assertFalse(env.probe([python,'-m','pip','--version']))
            env.bootstrap_pip(sys.executable,python)
            self.assertTrue(env.probe([python,'-m','pip','--version']))


if __name__=='__main__':unittest.main()
