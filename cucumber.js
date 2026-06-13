const { time } = require("node:console");

module.exports = {
  default: {
    // Feature files location
    paths: ['features/**/*.feature'],
    require: ['steps/**/*.steps.ts'],
    // Step definitions location
    // CHOOSE ONE OF THESE APPROACHES:
    
    // Option 1: Use POM approach (with page objects) - CURRENTLY ACTIVE
    // require: ['steps/login-pom.steps.ts', 'steps/world.ts'],
    
    // Option 2: Use Simple approach (without POM - direct Playwright)
    // require: ['steps/login-simple.steps.ts', 'steps/simpleWorld.ts'],
    
    // Option 3: Use Basic approach (no world, direct variables)

    // World parameters
    worldParameters: {
      // Add any world configuration here
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
