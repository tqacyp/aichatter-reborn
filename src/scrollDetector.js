export class AdvancedScrollDetector {
  constructor(options = {}) {
    this.isScrolling = false;
    this.isMouseWheelScrolling = false;
    this.isTouchScrolling = false;
    this.delay = options.delay || 150;
    this.debug = options.debug || false;
    
    this.init();
  }

  init() {
    // 检测鼠标滚轮
    window.addEventListener('wheel', this.handleWheelStart.bind(this));
    
    // 检测触摸滑动
    window.addEventListener('touchstart', this.handleTouchStart.bind(this));
    window.addEventListener('touchmove', this.handleTouchMove.bind(this));
    window.addEventListener('touchend', this.handleTouchEnd.bind(this));
    
    // 通用滚动检测
    window.addEventListener('scroll', this.handleScroll.bind(this));
  }

  handleWheelStart() {
    this.isMouseWheelScrolling = true;
    this.updateScrollingState();
    
    if (this.debug) console.log('鼠标滚轮滚动');
    
    clearTimeout(this.mouseWheelTimer);
    this.mouseWheelTimer = setTimeout(() => {
      this.isMouseWheelScrolling = false;
      if (this.debug) console.log('鼠标滚轮停止');
    }, this.delay);
  }

  handleTouchStart() {
    this.isTouchActive = true;
    if (this.debug) console.log('触摸开始');
  }

  handleTouchMove() {
    if (this.isTouchActive) {
      this.isTouchScrolling = true;
      this.updateScrollingState();
      
      if (this.debug) console.log('触摸滑动中');
      
      clearTimeout(this.touchTimer);
      this.touchTimer = setTimeout(() => {
        this.isTouchScrolling = false;
        if (this.debug) console.log('触摸滑动停止');
      }, this.delay);
    }
  }

  handleTouchEnd() {
    this.isTouchActive = false;
    if (this.debug) console.log('触摸结束');
  }

  handleScroll() {
    this.updateScrollingState();
    
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      this.isScrolling = false;
      if (this.debug) console.log('所有滚动停止');
    }, this.delay);
  }

  updateScrollingState() {
    this.isScrolling = true;
    if (this.debug) {
      console.log('滚动状态更新:', {
        通用滚动: this.isScrolling,
        鼠标滚轮: this.isMouseWheelScrolling,
        触摸滑动: this.isTouchScrolling
      });
    }
  }

  // 获取详细状态
  getDetailedStatus() {
    return {
      isScrolling: this.isScrolling,
      isMouseWheelScrolling: this.isMouseWheelScrolling,
      isTouchScrolling: this.isTouchScrolling,
      isAnyScrolling: this.isScrolling || this.isMouseWheelScrolling || this.isTouchScrolling
    };
  }

  // 获取简单状态
  isScrollingNow() {
    return this.isScrolling;
  }
}