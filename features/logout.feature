Feature: User Logout
  As a logged in user
  I want to log out of the application
  So that my session is closed and the login page is shown again

  Background:
    Given I navigate to the login page

  Scenario: Logged in user can log out
    When I login with valid credentials "testadmin" and "Vibetestq@123#"
    Then I should be redirected to the dashboard page
    When I open the user profile menu
    And I click on the logout option
    Then I should be returned to the login page
