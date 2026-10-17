(function() {
    'use strict';

    // 1. Define the parameters you need to submit
    const TARGET_URL = window.location.href; // Changes this if sending to a different action endpoint

    // 2. Identify the element you want to remove/replace
    // Replace '.target-element-selector' with the actual CSS class, ID, or tag name
    const targetElement = document.querySelector('form[name="frmDn"]');

    if (targetElement) {
        // 2. Find all table rows inside that form
        const rows = targetElement.querySelectorAll('tr');

        // 3. Find the specific row that includes the text "Security code :"
        const securityCodeRow = Array.from(rows).find(row => row.textContent.includes('Security code :'));
        const dynamicInput = targetElement.querySelector('input[name^="tmpinfo"]');

        if (!securityCodeRow || !dynamicInput.value) {
            return;
        }

        // 1. Get all TD elements inside this row
        const cells = Array.from(securityCodeRow.querySelectorAll('td'));

        // 2. Map over the cells to get their text, skipping index 0 (the label)
        const digitCells = cells.slice(1); // Takes index 1 to the end

        // 3. Extract the text content and join them together
        const securityCodeValue = digitCells.map(td => td.textContent.trim()).join('');

        // 3. Create the simple download button
        const downloadBtn = document.createElement('input');
        downloadBtn.type = 'submit';
        downloadBtn.value = 'DOWNLOAD';
        downloadBtn.innerText = '⬇️ Download File';

        // Apply clean styles so it looks like a standard download button
        downloadBtn.style.padding = '10px 20px';
        downloadBtn.style.backgroundColor = '#007bff';
        downloadBtn.style.color = '#fff';
        downloadBtn.style.border = 'none';
        downloadBtn.style.borderRa = '5px';
        downloadBtn.style.cursor = 'pointer';
        downloadBtn.style.fontWeight = 'bold';

        // Build a hidden form dynamically to ensure a clean POST submit
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = TARGET_URL; //
        //form.style.display = 'none';

        // Create hidden input field for 'innum'
        const innumInput = document.createElement('input');
        innumInput.type = 'hidden';
        innumInput.name = 'innum';
        innumInput.value = securityCodeValue;
        form.appendChild(innumInput);

        // Create hidden input field for 'tmpinfo1aa'
        const tmpinfoInput = document.createElement('input');
        tmpinfoInput.type = 'hidden';
        tmpinfoInput.name = 'tmpinfo1aa';
        tmpinfoInput.value = dynamicInput.value;
        form.appendChild(tmpinfoInput);

        form.appendChild(downloadBtn);

        // 5. Swap the elements in the DOM
        targetElement.parentNode.replaceChild(form, targetElement);
    }

    const addContainer = document.querySelector('.fc-ab-root');

    if (addContainer) {
        document.body.removeChild(addContainer);
    }
})();
