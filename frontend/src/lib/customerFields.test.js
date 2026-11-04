import { buildCustomerAddress, formatCustomerCep, formatCustomerPhone } from "./customerFields";

describe("customer registration field formatting", () => {
  test("formats CEP digits for display", () => {
    expect(formatCustomerCep("21745590")).toBe("21745-590");
  });

  test("formats mobile numbers with the Rio de Janeiro area code", () => {
    expect(formatCustomerPhone("21987654321")).toBe("(21) 98765-4321");
    expect(formatCustomerPhone("(21) 98765-4321")).toBe("(21) 98765-4321");
    expect(formatCustomerPhone("2122223333")).toBe("(21) 2222-3333");
  });

  test("composes the customer address with number and CEP", () => {
    expect(buildCustomerAddress({
      logradouro: "Rua Exemplo",
      bairro: "Centro",
      localidade: "Rio de Janeiro",
      uf: "RJ",
    }, "550", "21745590")).toBe("Rua Exemplo, 550, Centro, Rio de Janeiro - RJ, CEP 21745-590");
  });
});
