import { chromium } from 'playwright';

async function testDetail() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    page.on('response', async response => {
        const url = response.url();
        if (url.includes('api') || url.includes('json') || url.includes('rest') || url.includes('ver-causa')) {
            if (response.request().method() !== 'OPTIONS' && !url.endsWith('.html') && !url.endsWith('.js') && !url.endsWith('.css')) {
                console.log('API:', response.request().method(), url);
                try {
                    const json = await response.json();
                    console.log(JSON.stringify(json).substring(0, 200));
                } catch (e) { }
            }
        }
    });

    await page.goto('https://www.portaljudicial1ta.cl/sgc-web/ver-causa.html?rol=R-149-2026', { waitUntil: 'networkidle' });
    await new Promise(r => setTimeout(r, 5000));
    await browser.close();
}
testDetail();
