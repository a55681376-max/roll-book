const fs=require('fs');
// 배포에는 웹 화면만 포함한다. 테스트 계정과 SQL·개발 도구는 제외한다.
fs.mkdirSync('dist',{recursive:true});
fs.copyFileSync('index.html','dist/index.html');
console.log('전자출석부 배포 파일 준비 완료');
