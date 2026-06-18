import os, shutil, pathlib, html

pr_num        = os.environ['PR_NUM']
pr_title      = html.escape(os.environ['PR_TITLE'])
owner         = os.environ['OWNER']
repo          = os.environ['REPO']
branch_suffix = os.environ['BRANCH_SUFFIX']   # e.g. "empmgmt" from "test-gen/empmgmt"
sdf_env       = os.environ.get('STEP_DEF_FILES', '').strip()
step_def_files = sdf_env.split() if sdf_env else []

# Publish to test-gen/{branch-suffix}/ — same path the agent pre-computes for the PR body URL
deploy = pathlib.Path(f'gh-pages-deploy/test-gen/{branch_suffix}')
for d in ['allure', 'cucumber', 'steps']:
    (deploy / d).mkdir(parents=True, exist_ok=True)

# Allure report
shutil.copytree('allure-report', deploy / 'allure', dirs_exist_ok=True)

# Cucumber HTML report
src = pathlib.Path('cucumber-report.html')
if src.exists():
    shutil.copy(src, deploy / 'cucumber' / 'index.html')
else:
    (deploy / 'cucumber' / 'index.html').write_text(
        '<html><body><p>No Cucumber report generated.</p></body></html>')

# Step definition source files (as .txt for browser viewing)
steps_links = []
for f in step_def_files:
    p = pathlib.Path(f)
    if p.exists():
        dest = deploy / 'steps' / (p.name + '.txt')
        shutil.copy(p, dest)
        steps_links.append(f'<li><a href="{html.escape(p.name)}.txt">{html.escape(p.name)}</a></li>')

steps_ul = '\n'.join(steps_links) if steps_links else '<li><em>No step definition files detected in this PR</em></li>'

# Steps index
(deploy / 'steps' / 'index.html').write_text(f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Step Definitions - {branch_suffix} (PR #{pr_num})</title>
<style>
  body{{font-family:Arial,sans-serif;max-width:600px;margin:40px auto;background:#f5f5f5;padding:16px}}
  li{{margin:10px 0}} a{{color:#4a90d9;font-size:15px}}
  h2{{color:#333}} .back{{margin-top:32px}}
</style></head>
<body>
  <h2>Generated Step Definitions - {branch_suffix}</h2>
  <p style="color:#888;font-size:13px">PR #{pr_num}</p>
  <ul>{steps_ul}</ul>
  <p class="back"><a href="../">Back to validation report</a></p>
</body></html>""")

# Landing page
(deploy / 'index.html').write_text(f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{branch_suffix} - Test-Gen Validation</title>
  <style>
    body{{font-family:Arial,sans-serif;max-width:700px;margin:60px auto;background:#f5f5f5;padding:0 16px}}
    h1{{color:#333;font-size:1.4rem;margin-bottom:4px}}
    .meta{{color:#888;font-size:13px;margin-bottom:36px}}
    .cards{{display:flex;gap:20px;flex-wrap:wrap}}
    a.card{{display:block;padding:28px 36px;border-radius:10px;text-decoration:none;
            font-size:16px;font-weight:bold;color:white;
            box-shadow:0 2px 8px rgba(0,0,0,.15);text-align:center;min-width:140px}}
    .allure{{background:#e85a4f}}
    .cucumber{{background:#23d96c;color:#1a4d2e}}
    .steps{{background:#4a90d9}}
    .label{{color:#666;font-size:12px;margin-top:8px;text-align:center}}
  </style>
</head>
<body>
  <h1>test-gen/{branch_suffix}</h1>
  <p class="meta">{pr_title} &nbsp;·&nbsp; PR #{pr_num}</p>
  <div class="cards">
    <div>
      <a class="card allure" href="allure/index.html">Allure Report</a>
      <p class="label">Test results and history</p>
    </div>
    <div>
      <a class="card cucumber" href="cucumber/index.html">Cucumber Report</a>
      <p class="label">Scenarios and step details</p>
    </div>
    <div>
      <a class="card steps" href="steps/">Step Definitions</a>
      <p class="label">Generated .steps.ts source</p>
    </div>
  </div>
</body>
</html>""")

print(f"gh-pages deploy directory ready: {deploy}")
