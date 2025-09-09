from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8033'
sid = open('_sid.txt').read().strip()
with sync_playwright() as p:
  b=p.chromium.launch(headless=True); ctx=b.new_context()
  # Set session cookie
  ctx.add_cookies([{ 'name':'sessionid','value':sid,'domain':'127.0.0.1','path':'/','httpOnly':True }])
  page = ctx.new_page()
  page.goto(BASE + '/pos-retail/', timeout=60000)
  # Check elements
  page.wait_for_selector('#modalDescuentos', timeout=20000, state='attached')
  # Open and close modal by clicking button
  page.click('button[data-bs-target="#modalDescuentos"]')
  page.wait_for_selector('#modalDescuentos.show', timeout=5000)
  page.click('#modalDescuentos .btn-close')
  page.wait_for_selector('#modalDescuentos:not(.show)', timeout=5000)
  print('OK discounts modal')
  b.close()
