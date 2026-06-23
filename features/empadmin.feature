Feature: End to End Employee Management in Admin Module
  As an HR administrator using the PIM module
  I want to log in and add a new employee with unique details
  So that the employee record is created and available for further management
  And verify employee record creation by searching for the newly added employee using the stored employee id

  Background:
    Given I navigate to the login page

  Scenario: End to End flow for adding emp
    When I login with valid credentials "testadmin" and "Vibetestq@123#"
    Then I should be redirected to the dashboard page
    When I click on the PIM link
    Then I should see the PIM module
    When I click on add button
    Then I should see the add employee form
    And I read the employee id from the employee id textbox and store it in a variable
    When I add a new employee with unique details
    Then I see the personal details page
    When I click on the PIM link
    Then I should see the PIM module
    When I search for the newly added employee using the stored employee id
    Then I should see the employee record created in the search results