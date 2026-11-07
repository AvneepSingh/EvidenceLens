#!/usr/bin/env python3
"""Launch this checkout's interface and gateway using the existing setup engine."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "c"))
import setup_flow  # noqa: E402


def configured_for_checkout(cfg):
    """Reuse the model/binary, but always execute this checkout's Python gateway."""
    result = dict(cfg)
    result["launcher"] = str(ROOT / "c" / "coli")
    result["env"] = dict(cfg.get("env") or {})
    # A saved engine can live in another checkout or a downloaded runtime.
    # COLI_ENGINE is the launcher's existing explicit binary override.
    result["env"]["COLI_ENGINE"] = str(Path(cfg["engine"]).resolve())
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    args, setup_args = parser.parse_known_args(argv)
    if args.port is not None and not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    blocked = {"--background", "--json", "--list", "--no-start"}.intersection(setup_args)
    if blocked:
        parser.error(f"unsupported launcher options: {', '.join(sorted(blocked))}")

    dist = ROOT / "web" / "dist"
    index = dist / "index.html"
    if not index.is_file() or "EvidenceLens" not in index.read_text(encoding="utf-8"):
        raise setup_flow.SetupError("EvidenceLens is not built. Run ./start-evidencelens.sh first.")
    # The server checks c/web/dist before web/dist. Refuse a shadowing old build.
    if (ROOT / "c" / "web" / "dist" / "index.html").is_file():
        raise setup_flow.SetupError(
            "c/web/dist shadows this checkout's web/dist. Move that old build aside and rerun.")

    # Read the original setup once, then isolate all EvidenceLens changes locally.
    previous = setup_flow.load_config()
    os.environ["COLI_SETUP_HOME"] = str(ROOT / ".evidencelens")
    cfg = setup_flow.load_config()
    if cfg is None and previous and setup_flow.config_ready(previous):
        cfg = setup_flow.save_config(configured_for_checkout(previous))
        print("Reusing your configured model and engine; the original setup is unchanged.")
    if setup_args or not cfg or not setup_flow.config_ready(cfg):
        command = [sys.executable, str(ROOT / "c" / "coli"), "setup",
                   "--no-start", "--no-browser", *setup_args]
        if args.host is not None:
            command += ["--host", args.host]
        if args.port is not None:
            command += ["--port", str(args.port)]
        subprocess.run(command, check=True)
        cfg = setup_flow.load_config()
    if not cfg or not setup_flow.config_ready(cfg):
        raise setup_flow.SetupError("Model setup is incomplete. Run ./start-evidencelens.sh again to resume.")

    cfg = configured_for_checkout(cfg)
    for flag, value in (("--host", args.host), ("--port", args.port)):
        if value is not None:
            cfg[flag[2:]] = value
            cfg["args"] = setup_flow._replace_arg(cfg["args"], flag, str(value))
    cfg["urls"] = setup_flow.urls(cfg["host"], int(cfg["port"]))
    cfg = setup_flow.save_config(cfg)
    host, port = cfg["host"], int(cfg["port"])
    shown = "127.0.0.1" if host in ("0.0.0.0", "") else host
    url = f"http://{shown}:{port}/"
    print(f"\nEvidenceLens: {url}")
    print(f"Interface:   {dist}")
    print(f"Gateway:     {cfg['launcher']}")
    print(f"Model:       {cfg['model_dir']}")
    print(f"Engine:      {cfg['engine']}")
    print("PDF analyzer and model API use this same address; no manual endpoint setup is needed.")
    if args.check:
        print("Launch configuration checked. No model server was started.")
        return 0

    status = setup_flow.server_status(cfg)
    if status["state"] in ("ready", "loading") or not setup_flow.port_free(host, port):
        # Never return success for the old app just because /health answers.
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                existing = response.read(1_000_000)
        except (OSError, urllib.error.URLError):
            existing = b""
        if status["state"] == "ready" and existing == index.read_bytes():
            try:
                key = os.environ.get("COLI_API_KEY") or (cfg.get("env") or {}).get("COLI_API_KEY")
                if "--api-key" in cfg.get("args", []):
                    key = cfg["args"][cfg["args"].index("--api-key") + 1]
                request = urllib.request.Request(url + "v1/documents",
                            headers={"Authorization": f"Bearer {key}"} if key else {})
                with urllib.request.urlopen(request, timeout=3) as response:
                    capabilities = json.load(response)
                if capabilities.get("service") != "evidencelens_documents" or capabilities.get("version") != 1:
                    raise ValueError("older document service")
            except (OSError, ValueError):
                raise setup_flow.SetupError(
                    "An older EvidenceLens server is already running. Stop it with Ctrl+C in its terminal, "
                    "then rerun ./start-evidencelens.sh to load the Python document pipeline.")
            print("EvidenceLens is already running.")
            if not args.no_browser:
                webbrowser.open(url)
            return 0
        raise setup_flow.SetupError(
            f"Port {port} already has a server or a model is still loading. "
            "Stop the previous launch with Ctrl+C in its terminal, then rerun this script. "
            f"Alternatively choose another port: ./start-evidencelens.sh --port {port + 1 if port < 65535 else 8000}")

    sys.stdout.flush()
    return setup_flow.start_server(cfg, background=False, open_browser=not args.no_browser)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (setup_flow.SetupError, subprocess.CalledProcessError) as error:
        print(f"EvidenceLens: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
