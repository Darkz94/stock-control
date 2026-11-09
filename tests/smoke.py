"""End-to-end smoke run for local Stock Control prototype. Requires playwright + Chromium."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import os
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
shots=Path(os.environ.get('SMOKE_SCREENSHOTS', root/'tests'/'screenshots'))
shots.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
Thread(target=server.serve_forever,daemon=True).start()
errors=[]
try:
    with sync_playwright() as p:
        exe=os.environ.get('CHROMIUM_PATH')
        browser=p.chromium.launch(headless=True,args=['--no-sandbox'],**({'executable_path':exe} if exe else {}))
        page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
        assert page.get_by_text('Your stock, at a glance').is_visible()
        page.screenshot(path=str(shots/'stock-control-desktop.png'),full_page=True)
        page.locator('button[data-view="inventory"]').first.click()
        assert page.locator('.product').count()==16
        missing=page.locator('img').evaluate_all('(images)=>images.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)')
        assert not missing,f'Broken images: {missing}'
        page.locator('button[data-action="adjust-stock"][data-id="pine-gel-5l"]').click()
        page.locator('#stock-quantity').fill('12')
        page.locator('#stock-reason').fill('Test stock received')
        page.get_by_role('button',name='Save stock movement').click()
        assert page.locator('.product').filter(has_text='Pine gel').filter(has_text='5 L bucket').locator('.stock-qty').inner_text().startswith('12')
        page.locator('button[data-view="orders"]').first.click()
        page.get_by_role('button',name='＋ Manual order',exact=True).click()
        page.locator('#order-manager').fill('Test Manager')
        page.locator('#order-phone').fill('082 123 4567')
        page.locator('#order-site').fill('Test site')
        page.locator('#order-message').fill('2 x Pine gel 5 L')
        page.get_by_role('button',name='↳ Read product lines').click()
        assert page.locator('.order-product').input_value()=='pine-gel-5l'
        assert page.locator('.order-qty').input_value()=='2'
        page.get_by_role('button',name='Create order ticket').click()
        assert page.get_by_text('New request',exact=True).count()>=1
        page.get_by_role('button',name='Start preparing').click()
        page.get_by_role('button',name='✓ Ready to collect').click()
        page.get_by_role('button',name='Mark collected & deduct stock').click()
        assert page.get_by_text('Collected',exact=True).count()>=1
        page.locator('.modal-actions').get_by_role('button',name='Close',exact=True).click()
        page.locator('button[data-view="inventory"]').first.click()
        assert page.locator('.product').filter(has_text='Pine gel').filter(has_text='5 L bucket').locator('.stock-qty').inner_text().startswith('10')
        page.set_viewport_size({'width':390,'height':844})
        page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
        page.screenshot(path=str(shots/'stock-control-mobile.png'),full_page=True)
        assert page.get_by_text('Your stock, at a glance').is_visible()
        assert not errors,f'Page JavaScript errors: {errors}'
        print('PASS: dashboard, 16 images, receiving, WhatsApp parsing, tickets, collection stock deduction, mobile view, JS errors')
        browser.close()
finally:server.shutdown()
