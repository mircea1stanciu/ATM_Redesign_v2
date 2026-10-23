Feature: Posts API

  Background:
    * url baseUrl

  Scenario: Get a post
    Given path 'posts', 1
    When method get
    Then status 200
    And match response.id == 1

  Scenario: Create a post
    Given path 'posts'
    And request { title: 'Hello from ATM', body: 'Created by the starter project', userId: 1 }
    When method post
    Then status 201
    And match response.title == 'Hello from ATM'
