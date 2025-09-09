from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8034'
sid = open('_sid.txt').read().strip()
with sync_playwright() as p:
  b=p.chromium.launch(headless=True); ctx=b.new_context()
  ctx.add_cookies([{ 'name':'sessionid','value':sid,'domain':'127.0.0.1','path':'/' }])
  page = ctx.new_page()
  page.goto(BASE + '/pos-retail/', timeout=60000)
  print('URL:', page.url)
  html = page.content()
  open('_dbg_pos2.html','w',encoding='utf-8').write(html)
  print('HAS descuentos?', '#modalDescuentos' in html)
  print('HAS sim?', '#modalSimV5' in html)
  print('HEAD title:', page.title())
  b.close()
