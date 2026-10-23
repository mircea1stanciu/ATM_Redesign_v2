package com.atm.tests;

import com.intuit.karate.junit5.Karate;

class PostsRunnerTest {

    @Karate.Test
    Karate posts() {
        return Karate.run("posts").relativeTo(getClass());
    }
}
