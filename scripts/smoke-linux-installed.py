"""Exercise an installed Linux package through Tauri's real WebDriver/IPC.

Requires tauri-driver, WebKitWebDriver and python3-selenium; run inside Xvfb.
Uses only generated fixtures and a separate test user's application data.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.options import ArgOptions
from selenium.webdriver.support.ui import WebDriverWait


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--omr", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    server = subprocess.Popen(["/usr/local/bin/loopstudio-tauri-driver"], stdout=subprocess.DEVNULL)
    driver = None
    try:
        time.sleep(1)
        options = ArgOptions()
        options.set_capability("browserName", "wry")
        options.set_capability("tauri:options", {"application": "/usr/bin/loopstudio"})
        driver = webdriver.Remote("http://127.0.0.1:4444", options=options)
        driver.set_script_timeout(180)
        wait = WebDriverWait(driver, 45)
        wait.until(lambda d: "Deine Übungsprojekte" in d.find_element(By.TAG_NAME, "body").text)
        driver.save_screenshot(str(args.output / "linux-home.png"))

        def invoke(command, value):
            result = driver.execute_async_script("""
const done=arguments[arguments.length-1];
window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({ok:true,value})).catch(error=>done({ok:false,error:String(error)}));
""", command, value)
            assert result["ok"], result
            return result["value"]

        status = invoke("tab_tools_status", {})
        assert status["pdf"], status
        results = {"status": status}
        for engine, fixture in [("pdf", args.fixture), ("omr", args.omr)]:
            if fixture is None:
                continue
            encoded = base64.b64encode(fixture.read_bytes()).decode()
            staged = driver.execute_async_script("""
const done=arguments[arguments.length-1], bytes=Uint8Array.from(atob(arguments[0]),c=>c.charCodeAt(0));
window.__TAURI_INTERNALS__.invoke('stage_tab_input',bytes).then(value=>done({ok:true,value})).catch(error=>done({ok:false,error:String(error)}));
""", encoded)
            assert staged["ok"], staged
            result = invoke("run_tab_tool", {"source": staged["value"]["path"], "engine": engine,
                            "bpm": 120, "jobId": f"installed-{engine}-smoke", "strings": 0})
            assert len(base64.b64decode(result["gp5"])) > 100, result
            results[engine] = {"filename": result["filename"], "report": result["report"]}
        # Smoke-test the shipped notation/GP7 assets as well as the native backend.
        driver.find_element(By.XPATH, "//button[contains(., 'Demo ausprobieren')]").click()
        wait.until(lambda d: "Evening practice" in d.find_element(By.TAG_NAME, "body").text)
        wait.until(lambda d: d.execute_script("return !!document.querySelector('video')"))
        wait.until(lambda d: d.execute_script("return !document.querySelector('.project-operation')"))
        driver.save_screenshot(str(args.output / "linux-demo.png"))
        results["demoLoaded"] = True
        (args.output / "installed-smoke.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(json.dumps(results, indent=2), flush=True)
    finally:
        if driver:
            driver.quit()
        server.terminate()
        server.wait(timeout=15)


if __name__ == "__main__":
    main()
