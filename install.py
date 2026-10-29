#!/usr/bin/env python3
"""Install per-user files only; never modifies the compositor's main config."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess

FILES = ['web_bridge.py', 'web_support.py', 'desktop_support.py', 'overlay.qml',
         'web/manifest.json', 'web/background.js', 'web/content.js', 'web/popup.html',
         'web/popup.js', 'web/chatgpt.js', 'web/claude.js', 'check-test/index.html', 'README.md', 'PROMPT.txt', 'install.py']

def check():
    missing = [name for name in ['python3', 'firefox', 'grim', 'tesseract', 'qs', 'notify-send', 'hyprctl'] if not shutil.which(name)]
    try:
        import PIL
    except ImportError:
        missing.append('python-pillow')
    if shutil.which('tesseract'):
        result = subprocess.run(['tesseract', '--list-langs'], capture_output=True, text=True)
        if 'eng' not in result.stdout.splitlines(): missing.append('tesseract-data-eng')
    if missing: raise SystemExit('Встановіть залежності: ' + ', '.join(missing) + '\nКоманда є в README.md.')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--check', action='store_true', help='Only check dependencies')
    args = p.parse_args()
    check()
    if args.check:
        print('Залежності доступні.'); return
    if os.geteuid() == 0: raise SystemExit('Запускайте без sudo, від користувача Firefox.')
    base = Path(__file__).resolve().parent
    target = Path.home() / '.local/share/gemini-dot-web'
    host = Path.home() / '.mozilla/native-messaging-hosts/ua.gemini_dot.json'
    if any(c in str(target) for c in ['\n','\r','#',',']):
        raise SystemExit('Непідтримуваний символ у домашньому шляху для Hyprland config.')
    if host.is_symlink(): raise SystemExit('Маніфест є символічним посиланням: '+str(host))
    for item in FILES + ['hyprland.lua', 'hyprland.conf', 'hyprland-legacy.conf', '.gemini-dot-install']:
        dest = target/item
        for part in [dest, *dest.parents]:
            if part == target.parent: break
            if part.is_symlink(): raise SystemExit('Не перезаписую символічне посилання: '+str(part))
    manifest = {'name':'ua.gemini_dot', 'description':'Gemini Dot Web',
                'path':str(target/'web_bridge.py'), 'type':'stdio',
                'allowed_extensions':['gemini-dot@local.invalid']}
    if host.exists() and json.loads(host.read_text()).get('path') != manifest['path']:
        raise SystemExit('Інший Gemini Dot вже зареєстровано. Спершу видаліть його або узгодьте перенесення: ' + str(host))
    if target.is_symlink(): raise SystemExit('Каталог встановлення не має бути символічним посиланням.')
    if target.exists() and not (target/'.gemini-dot-install').exists():
        raise SystemExit('Каталог уже існує без маркера встановлення: ' + str(target))
    for item in FILES:
        if not (base/item).is_file(): raise SystemExit('Неповний архів: '+item)
    target.mkdir(parents=True, exist_ok=True)
    for item in FILES:
        dest = target/item
        if dest.is_symlink(): raise SystemExit('Не перезаписую символічне посилання: '+str(dest))
        dest.parent.mkdir(parents=True, exist_ok=True)
        if (base/item).resolve() != dest.resolve(): shutil.copy2(base/item, dest)
    (target/'.gemini-dot-install').write_text('Gemini Dot Web 1.0\n')
    (target/'web_bridge.py').chmod(0o755)
    host.parent.mkdir(parents=True, exist_ok=True)
    host.write_text(json.dumps(manifest, indent=2)+'\n')
    command='/usr/bin/python3 '+shlex.quote(str(target/'web_bridge.py'))
    lua = ('-- Gemini Dot: include once; Up/Down are global shortcuts.\n'
        + 'hl.bind("Up", hl.dsp.exec_cmd('+json.dumps(command+' run')+'), { release = true })\n'
        + 'hl.bind("Down", hl.dsp.exec_cmd('+json.dumps(command+' cancel')+'), { release = true })\n'
        + 'hl.window_rule({name="gemini-dot-background", match={class="^firefox$", title=".*(Google Gemini|ChatGPT|Claude).*"}, render_unfocused=true})\n')
    # Quoted shell arguments in exec protect whitespace and shell metacharacters.
    # A literal config delimiter/newline in the installation path is unsupported.
    binds=f'bindr = , Up, exec, {command} run\nbindr = , Down, exec, {command} cancel\n'
    (target/'hyprland.lua').write_text(lua)
    (target/'hyprland.conf').write_text(binds+'windowrule = render_unfocused on, match:class ^firefox$, match:title .*(Google Gemini|ChatGPT|Claude).*\n')
    (target/'hyprland-legacy.conf').write_text(binds+'windowrulev2 = renderunfocused, class:^(firefox)$, title:.*(Google Gemini|ChatGPT|Claude).*\n')
    print('Встановлено:',target)
    print('У Firefox завантажте тимчасове розширення:',target/'web/manifest.json')
    print('Підключіть ОДИН фрагмент Hyprland за README.md. Основні конфігурації не змінено.')
    print('Lua: dofile('+json.dumps(str(target/'hyprland.lua'))+')')
    print('Hyprlang 0.53–0.54: source = '+str(target/'hyprland.conf'))
    print('Старіший Hyprlang: source = '+str(target/'hyprland-legacy.conf'))

if __name__ == '__main__': main()
