(function() {
    'use strict';

    function enableScrolling() {
        document.body.style.overflow = 'auto';
    }

    function hideElements() {
        // Select all elements with class 'fc-ab-root'
        let fcAbRootElements = document.querySelectorAll('.fc-ab-root');
        fcAbRootElements.forEach(element => {
            element.style.setProperty("display", "none", "important")
            for (const child of element.children) {
                child.style.display = 'none';
            }
        });

        // Select all elements with class that starts with 'fc-ab-'
        let fcAbElements = document.querySelectorAll('[class^="fc-ab-"]');
        fcAbElements.forEach(element => {
            element.style.setProperty("display", "none", "important")
            for (const child of element.children) {
                child.style.display = 'none';
            }
        });

        // Enable scrolling on body
        enableScrolling();
    }

    // Initial hide and enable scrolling
    hideElements();

    // MutationObserver to hide elements that are dynamically added to the DOM and enable scrolling
    let observer = new MutationObserver(hideElements);
    observer.observe(document.body, { childList: true, subtree: true });
})();
