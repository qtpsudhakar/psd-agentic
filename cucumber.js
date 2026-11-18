module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: [
      'support/world.ts',
      'support/hooks.ts',
      'support/step-healer.ts', // Cucumber step healer (off unless STEP_HEAL=true) + {{run}} test data
      'steps/**/*.steps.ts',
    ],
    requireModule: ['ts-node/register'],
    format: [
      'pretty',
      'html:cucumber-report.html',
      'json:cucumber-report.json',
      'rerun:reports/rerun.txt',
      'allure-cucumberjs/reporter',
    ],
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

// Run only the feature files / scenarios named on the command line, e.g.
//   npx cucumber-js --profile files features/empmgmt.feature:9
// (with the default profile, Cucumber adds named files to `paths` and still runs everything)
module.exports.files = { ...module.exports.default, paths: [] };
