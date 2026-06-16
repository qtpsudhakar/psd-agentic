Feature: End to end Emp Management
  As a user of the PIM system
  I want to authenticate with valid credentials
  So that I can access the system securely

  Background:
    Given I navigate to the login page

  Scenario: End to End flow for adding employee
    When I login with valid credentials "testadmin" and "Vibetestq@123#"
    Then I should be redirected to the dashboard page
    When I click on the PIM link
    Then I should see the PIM module
    When I click on add button
    Then I should see the add employee form 
    When I add a new employee with unique details
    Then I see the personal details page
