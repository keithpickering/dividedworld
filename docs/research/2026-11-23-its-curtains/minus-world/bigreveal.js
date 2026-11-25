// Big Reveal plugin
(function($) {
  var loop = new SeamlessLoop();
  loop.addUri("./audio/drumroll.ogg", 2000, "drumroll");
  loop.addUri("./audio/tada.ogg", 3200, "tada");
  loop.callback(function() {});

  var mwBigReveal = function(element) {
    var post = $(element);
    var obj = this;

    this.resize = function() {};

    this.init = function() {
      var curtainTop = $(
        '<div class="spell--bigreveal__curtain spell--bigreveal__curtain--top" />'
      );
      curtainTop.appendTo(post);
      var curtainLeft = $(
        '<div class="spell--bigreveal__curtain spell--bigreveal__curtain--left" />'
      );
      curtainLeft.appendTo(post);
      var curtainRight = $(
        '<div class="spell--bigreveal__curtain spell--bigreveal__curtain--right" />'
      );
      curtainRight.appendTo(post);
      var light = $('<div class="spell--bigreveal__lights" />');
      light.appendTo(post);

      post.addClass("spell--bigreveal--closed");

      post.on("mouseenter", function() {
        if (post.hasClass("spell--bigreveal--closed")) {
          loop.start("drumroll");
        }
      });

      post.on("mouseleave", function() {
        if (post.hasClass("spell--bigreveal--closed")) {
          loop.stop();
        }
      });

      post.on("click", function(e) {
        if (post.hasClass("spell--bigreveal--closed")) {
          loop.stop();
          // Cheating by using the looping audio plugin
          // for this since it only plays once, but this
          // way we can preload it so it plays right away
          loop.start("tada");
          setTimeout(function() {
            loop.stop();
          }, 3150);
          //setTimeout(function() {
          post.addClass("spell--bigreveal--open");
          setTimeout(function() {
            post.removeClass("spell--bigreveal--closed");
            curtainLeft.remove();
            curtainRight.remove();
            curtainTop.remove();
            light.remove();
          }, 750);
          //}, 100);
        }
      });
    };
  };

  $.fn.initMwBigReveal = function() {
    return this.each(function() {
      var element = $(this);

      // Return early if this element already has a plugin instance
      if (element.data("big-reveal-obj")) return;

      var bigRevealObj = new mwBigReveal(this);

      // Store plugin object in this element's data
      element.data("big-reveal-obj", bigRevealObj);

      bigRevealObj.init();
    });
  };
})(jQuery);

// Initiate
$(".spell--bigreveal").initMwBigReveal();
