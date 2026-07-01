package com.example.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

public class OrderService {

    @Autowired
    private UserClient userClient;

    @Transactional
    public Order findById(Long id) {
        this.validate();
        userClient.getUser(id);
        return null;
    }

    private void validate() {
        // no-op
    }
}