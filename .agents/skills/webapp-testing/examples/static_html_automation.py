from playwright.sync_api import sync_playwright
import os

# Example: Automating interaction with static HTML files using file:// URLs

# Every screenshot goes to the one fixed folder at the repo root, never a temp
# directory — temp is wiped, and evidence stored there is gone by the time the
# report is read. `output/` is git-ignored.
SCREENSHOT_DIR = 'output/screenshots'
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

html_file_path = os.path.abspath('path/to/your/file.html')
file_url = f'file://{html_file_path}'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})

    # Navigate to local HTML file
    page.goto(file_url)

    # Take screenshot
    page.screenshot(path=os.path.join(SCREENSHOT_DIR, '01-static-page.png'), full_page=True)

    # Interact with elements
    page.click('text=Click Me')
    page.fill('#name', 'John Doe')
    page.fill('#email', 'john@example.com')

    # Submit form
    page.click('button[type="submit"]')
    page.wait_for_timeout(500)

    # Take final screenshot
    page.screenshot(path=os.path.join(SCREENSHOT_DIR, '02-after-submit.png'), full_page=True)

    browser.close()

print("Static HTML automation completed!")