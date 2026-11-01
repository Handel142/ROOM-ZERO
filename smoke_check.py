"""Static smoke checks for the ROOM ZERO frontend package."""
from html.parser import HTMLParser
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.assets, self.actions = set(), [], set()
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            assert attrs['id'] not in self.ids, f"Duplicate id: {attrs['id']}"
            self.ids.add(attrs['id'])
        if tag == 'script' and attrs.get('src'):
            self.assets.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') in {'stylesheet', 'manifest', 'icon'}:
            self.assets.append(attrs.get('href'))
        if attrs.get('data-action'):
            self.actions.add(attrs['data-action'])

page = PageParser()
page.feed((ROOT / 'index.html').read_text(encoding='utf-8'))
for asset in page.assets:
    assert asset and (asset.startswith(('https://', 'http://')) or (ROOT / asset.split('?')[0]).is_file()), f'Missing linked asset: {asset}'
app = (ROOT / 'js/app.js').read_text(encoding='utf-8')
for action in sorted(page.actions):
    assert re.search(r"case\s+['\"]" + re.escape(action) + r"['\"]", app), f'No handler for page action: {action}'
required = ['index.html', 'css/styles.css', 'js/app.js', 'js/config.js', 'service-worker.js', 'manifest.webmanifest', 'supabase/schema.sql']
for item in required:
    assert (ROOT / item).is_file(), f'Missing required project file: {item}'
print(f'PASS: {len(page.actions)} page actions have handlers; {len(page.assets)} linked assets exist; required project files are present.')
