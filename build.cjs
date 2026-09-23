const fs=require('node:fs');
fs.mkdirSync('public',{recursive:true});
for(const file of ['index.html','style.css']) fs.copyFileSync(file,'public/'+file);
