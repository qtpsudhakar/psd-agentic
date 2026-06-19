const isDryRun = process.argv.includes('--dry-run');
module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: [
      'support/world.ts',
      'support/hooks.ts',
      'steps/**/*.steps.ts',
    ],
    requireModule: ['ts-node/register'],
    format: [
      'pretty',
      'html:cucumber-report.html',
      'json:cucumber-report.json',
      'rerun:reports/rerun.txt',
      ...(isDryRun ? [] : ['allure-cucumberjs/reporter']),

    ],
    formatOptions: {
      resultsDir: 'allure-results',
    },
    worldParameters: {
      baseUrl: 'https://vibetestq-osondemand.orangehrm.com/',
    },
    order: 'defined',
    parallel: 1,
    retry: 0,
    publishQuiet: true,
    publish: false,
    failFast: false,
    dryRun: false,
    strict: false,
    timeout: 120000,
    defaultTimeout: 120000,
    failOnUndefined: false,
  }
};
