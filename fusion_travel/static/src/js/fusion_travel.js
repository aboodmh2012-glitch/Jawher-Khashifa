/** @odoo-module **/

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('[data-ft-search-form="flight"]').forEach((form) => {
        const returnWrap = form.querySelector("[data-ft-return]");
        const radios = form.querySelectorAll('input[name="trip_type"]');
        const sync = () => {
            const selected = form.querySelector('input[name="trip_type"]:checked');
            const oneWay = selected && selected.value === "oneway";
            if (returnWrap) {
                returnWrap.hidden = oneWay;
                const input = returnWrap.querySelector("input");
                if (input) {
                    input.required = !oneWay;
                    if (oneWay) input.value = "";
                }
            }
        };
        radios.forEach((radio) => radio.addEventListener("change", sync));
        sync();
    });
    document.querySelectorAll(".ft-payment-option").forEach((option) => {
        option.addEventListener("click", () => {
            const input = option.querySelector('input[type="radio"]');
            if (input) input.checked = true;
        });
    });
});
