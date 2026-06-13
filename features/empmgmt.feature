Feature: End to end Emp Management
  As a user of the PIM system
  I want to authenticate with valid credentials
  So that I can access the system securely

  Background:
    Given I navigate to the login page

  Scenario: End to End flow
    When I login with valid credentials "testadmin" and "Vibetestq@123#"
    Then I should be redirected to the dashboard page
    When I navigate to the employee list page
    Then I should see the PIM module is accessible
    When I click on add button
    Then I should see the add employee form
    When I add a new employee with unique details
    Then the employee should be created successfully