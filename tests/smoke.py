"""End-to-end smoke run for local Stock Control prototype. Requires playwright + Chromium."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
Thread(target=server.serve_forever,daemon=True).start()
errors=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
        assert page.get_by_text('Your stock, at a glance').is_visible()
        page.screenshot(path='/mnt/data/stock-control-desktop.png',full_page=True)
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
        page.get_by_role('button',name='＋ New order',exact=True).click()
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
        page.get_by_role('button',name='✓ Order complete — ready to collect').click()
        page.get_by_role('button',name='Mark collected & deduct stock').click()
        assert page.get_by_text('Collected',exact=True).count()>=1
        page.get_by_role('button',name='Close',exact=True).click()
        page.locator('button[data-view="inventory"]').first.click()
        assert page.locator('.product').filter(has_text='Pine gel').filter(has_text='5 L bucket').locator('.stock-qty').inner_text().startswith('10')
        page.set_viewport_size({'width':390,'height':844})
        page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
        page.screenshot(path='/mnt/data/stock-control-mobile.png',full_page=True)
        assert page.get_by_text('Your stock, at a glance').is_visible()
        assert not errors,f'Page JavaScript errors: {errors}'
        print('PASS: dashboard, 16 images, receiving, WhatsApp parsing, tickets, collection stock deduction, mobile view, JS errors')
        browser.close()
finally:server.shutdown()
