module.exports = {
  default: {
    // Feature files location
    paths: ['features/**/*.feature'],
    require: [
      'support/world.ts',
      'support/hooks.ts',
      'steps/**/*.steps.ts',
    ],

    // World parameters
    worldParameters: {
      baseUrl: 'https://vibetestq-osondemand.orangehrm.com/',
    },
    
    // Format options
    format: [
      'html:cucumber-report.html',
      'json:cucumber-report.json',
      // '@cucumber/pretty-formatter'
    ],
    
    // // Require TypeScript setup
    requireModule: ['ts-node/register'],
    
    // Tags to run (optional - remove to run all)
    // tags: '@smoke or @login',
    
    // Parallel execution (optional)
    // parallel: 2,
    
    // Retry failed scenarios
    retry: 0,
    defaultTimeout: 120000, // 120 seconds
    timeout: 120000, // 120 seconds
    // Exit after first failure (optional)
    // failFast: true,
  }
};
