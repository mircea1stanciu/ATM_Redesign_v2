package com.atm.tests;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

class PostsApiTest {

    @BeforeAll
    static void configure() {
        RestAssured.baseURI = System.getProperty("baseUrl", "https://jsonplaceholder.typicode.com");
        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails();
    }

    @Test
    void getsAPost() {
        given()
            .when().get("/posts/{id}", 1)
            .then()
            .statusCode(200)
            .body("id", equalTo(1))
            .body("title", notNullValue());
    }

    @Test
    void createsAPost() {
        given()
            .contentType(ContentType.JSON)
            .body(Map.of("title", "Hello from ATM", "body", "Created by the starter project", "userId", 1))
            .when().post("/posts")
            .then()
            .statusCode(201)
            .body("title", equalTo("Hello from ATM"));
    }
}
