*** Settings ***
Documentation     Sample API tests. Run with: robot --outputdir reports tests
Resource          ../resources/api.resource
Suite Setup       Open API Session

*** Test Cases ***
Get A Post
    ${response}=    GET On Session    api    /posts/1
    Status Should Be    200    ${response}
    Post Should Have Id    ${response}    1

Create A Post
    ${body}=    Create Dictionary    title=Hello from ATM    body=Created by the starter project    userId=1
    ${response}=    POST On Session    api    /posts    json=${body}
    Status Should Be    201    ${response}
    Should Be Equal    ${response.json()}[title]    Hello from ATM
