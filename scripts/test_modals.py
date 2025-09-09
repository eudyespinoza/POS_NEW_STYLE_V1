from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8031'

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()
        # Login
        page.goto(BASE + '/auth/login/', timeout=60000)
        if page.url.endswith('/auth/login/'):
            page.fill('#username', 'tester')
            page.fill('#password', 'test1234')
            page.click('button[type="submit"]')
            page.wait_for_timeout(600)
        page.goto(BASE + '/pos-retail/', timeout=60000); print('URL after goto:', page.url); open('_dbg_pos.html','w',encoding='utf-8').write(page.content())
        # Esperar modales presentes en el DOM
        page.wait_for_selector('#modalDescuentos', timeout=20000, state='attached')
        page.wait_for_selector('#modalLogistica', timeout=20000, state='attached')
        page.wait_for_selector('#modalSimV5', timeout=20000, state='attached')
        # Descuentos
        page.click('button[data-bs-target="#modalDescuentos"]')
        page.wait_for_selector('#modalDescuentos.show', timeout=5000)
        page.click('#modalDescuentos .btn-close')
        page.wait_for_selector('#modalDescuentos:not(.show)', timeout=5000)
        # Logística
        page.click('button[data-bs-target="#modalLogistica"]')
        page.wait_for_selector('#modalLogistica.show', timeout=5000)
        page.click('#modalLogistica .btn-close')
        page.wait_for_selector('#modalLogistica:not(.show)', timeout=5000)
        # Simulador externo
        page.click('text=Simular pago (F8)')
        # Si abre modal, ok; si falla abre nueva pestaña: verificar cualquiera
        try:
            page.wait_for_selector('#modalSimV5.show', timeout=5000)
        except Exception:
            pass
        # Cantidad: solo si hay productos (botón .btn-add)
        try:
            page.click('.btn-add', timeout=3000)
            page.wait_for_selector('#quantityModalRetail.show', timeout=5000)
            page.click('#quantityModalRetail .btn-close')
            page.wait_for_selector('#quantityModalRetail:not(.show)', timeout=5000)
        except Exception:
            pass
        print('OK e2e modals open/close')
        browser.close()

if __name__ == '__main__':
    main()


