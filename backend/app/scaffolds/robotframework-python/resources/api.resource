*** Settings ***
Library    RequestsLibrary

*** Variables ***
${BASE_URL}    https://jsonplaceholder.typicode.com

*** Keywords ***
Open API Session
    Create Session    api    ${BASE_URL}    verify=True

Post Should Have Id
    [Arguments]    ${response}    ${expected_id}
    Should Be Equal As Integers    ${response.json()}[id]    ${expected_id}
