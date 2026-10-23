describe('Web form', () => {
  beforeEach(() => {
    cy.visit('web-form.html');
  });

  it('shows the form', () => {
    cy.title().should('eq', 'Web form');
    cy.get('h1').should('have.text', 'Web form');
  });

  it('submits the form', () => {
    cy.get('#my-text-id').type('Hello from ATM');
    cy.get('button[type=submit]').click();
    cy.get('h1').should('have.text', 'Form submitted');
    cy.get('#message').should('have.text', 'Received!');
  });
});
