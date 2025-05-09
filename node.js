import express, { query } from 'express'
import bodyParser from 'body-parser';
import path from 'path'
import { dirname } from 'path';
// import  axois from 'axois';
import { fileURLToPath } from 'url';
import pg from 'pg';
import multer from 'multer';
// to download database 
import { Parser } from 'json2csv';
// to download in excel format
import ExcelJS from 'exceljs';
import expressSession from 'express-session';


const db= new pg.Client(
  {
    user:"postgres",
    localhost: "localhost",
    database: "ndc ",
    password: "Coolhand-85",
    port: 5432,
  }
)

const __dirname =dirname(fileURLToPath(import.meta.url));
const app =express();
const port = 3300;
var validUSer =false;


app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');



app.use(expressSession({
  secret: 'your-secret-key', // Replace with a strong secret key
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to `true` in production when using HTTPS
}));



app.use(bodyParser.urlencoded({extended: true}));
import methodOverride from 'method-override';
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, "public")));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);  
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });



db.connect((err)=>{
  if(err){
    console.log(`failed to connect to database`,err)
  }else{
    console.log(`connection successful`)
  }
});


const passcode =async (req,res,next)=>{
  const {id,password,email} =req.body;

  
  try {
      const results =await db.query(`SELECT id, user_name, email, image, password FROM users WHERE email = $1`,[email])
      const users =results.rows[0];
      
      if(users){
        if(password === users.password){
          req.session.users =users;
          validUSer =true;
        }else{
          validUSer =false
        }
      }
      else{
        validUSer =false
      }
      if(!validUSer){
       return res.send('login failed pleace check creditails');
      }
      next();
  } catch (err) {
    console.error(`Error checking credentials`)
    res.status(500).send('Error Checking credentials')
  }
  };

app.get('/logout',(req,res)=>{
  req.session.destroy((err)=>{
    if(err){
      return res.status(500).send('Error logging out');
    }
  })
  res.render('IDV_USR/idv-home.ejs')
});

app.get('/',(req,res)=>{
  res.render('IDV_USR/idv-home.ejs')
})

app.get('/add',(req,res)=>{

  res.render('IDV_USR/idv-add.ejs')
})

app.get('/submit',(rea,res)=>{
  res.render('IDV_USR/idv-dashbaord.ejs')
})

app.post('/submit',passcode,async (req,res)=>{
  try {
    const userResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE email = $1', ['active']);
    const nssResults = await db.query('SELECT COUNT(*) AS count FROM users');
    const staffResults = await db.query('SELECT COUNT(*) AS count FROM users' );
    const totalResults = await db.query('SELECT COUNT(*) AS count FROM users');



    const usersResults = await db.query('SELECT id, email, image, user_name FROM users ');
    const metrics = {
      activeMembers: userResults.rows[0].count,
      nssPersonnel: nssResults.rows[0].count,
      staffMembers: staffResults.rows[0].count,
      totalMembers: totalResults.rows[0].count,
    };
    res.render('IDV_USR/idv-dashboard',{ metrics, users: req.users})

  } catch (err) {
    console.error('Error fetching data for dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }

  if(validUSer){
  }else{
    res.send('wrong message :: Check logins')
  }
})

app.post('/add',upload.single('photo'),async (req,res)=>{
  const {id,password,email,name} =req.body;
  const image = req.file ? `/uploads/${req.file.filename}`: null;

  try {
    await db.query(`INSERT INTO users (id,password,email,image,user_name)
       VALUES
       ($1,$2,$3,$4,$5)`
       ,[id,password,email,image,name]);
    res.render('IDV_USR/idv-home.ejs')
  } catch (err) {
    console.error('Error inserting data',err);
    res.status(500).send('error saving data');
  }
})



app.post('/events', async (req, res) => {
  const {
    id,
    day,
    minute,
    second,
    latitude,
    longitude,
    H,
    Mb,
    Ml,
    Az,
    location,
    nearest_location
  } = req.body;

  if (
    !id || !day || !minute || !second ||
    !latitude || !longitude || !H || !Mb ||
    !Ml || !Az || !location || !nearest_location
  ) {
    return res.status(400).send('All fields must be filled out.');
  }

  try {
    await db.query(`
      INSERT INTO data (
        id, day, minute, second, latitude, longitude, h, mb, ml, az, location, nearest_location
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (id) DO UPDATE SET
        day = EXCLUDED.day,
        minute = EXCLUDED.minute,
        second = EXCLUDED.second,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        h = EXCLUDED.h,
        mb = EXCLUDED.mb,
        ml = EXCLUDED.ml,
        az = EXCLUDED.az,
        location = EXCLUDED.location,
        nearest_location = EXCLUDED.nearest_location
    `, [
      id,
      day,
      minute,
      second,
      latitude,
      longitude,
      H,
      Mb,
      Ml,
      Az,
      location,
      nearest_location
    ]);

    res.redirect('/add');
  } catch (err) {
    console.error('Error inserting or updating event data:', err);
    res.status(500).send('Server error saving event data.');
  }
});



app.get('/manage-data',async (req,res)=>{
  try {
    const results =await db.query(`SELECT * FROM data`);
    console.log('Fetched events:', results.rows);
    res.render('IDV_USR/idv-manage-data',{data:results.rows })
  } catch (err) {
    console.error('Error Fetching data',err);
    res.status(500).send(`error in your client`);
  }
})

app.get('/search',async (req,res)=>{
  const {query} =req.query;
  try {
    const results =await db.query(
      `SELECT * FROM data WHERE 
        TO_CHAR(day, 'YYYY-MM-DD') ILIKE $1
        OR CAST(minute AS TEXT) ILIKE $2
        OR CAST(second AS TEXT) ILIKE $3
        OR CAST(latitude AS TEXT) ILIKE $4
        OR CAST(longitude AS TEXT) ILIKE $5
        OR CAST(h AS TEXT) ILIKE $6
        OR CAST(mb AS TEXT) ILIKE $7
        OR CAST(ml AS TEXT) ILIKE $8
        OR CAST(az AS TEXT) ILIKE $9
        OR location ILIKE $10
        OR nearest_location ILIKE $11`,
        [`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`]
    )
    res.render("IDV_USR/idv-manage-data.ejs",{data:results.rows})
  } catch (err) {
    console.error('Error fetching data',err)
    res.status(500).send('error on user end');
  }
});


app.get('/dashboard', async (req, res) => {

  if(!req.session.user){
    return res.redirect('/login')
  }


  try {
    const userResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE email = $1', ['active']);
    const nssResults = await db.query('SELECT COUNT(*) AS count FROM users');
    const staffResults = await db.query('SELECT COUNT(*) AS count FROM users' );
    const totalResults = await db.query('SELECT COUNT(*) AS count FROM users');

    const metrics = {
      activeMembers: userResults.rows[0].count,
      nssPersonnel: nssResults.rows[0].count,
      staffMembers: staffResults.rows[0].count,
      totalMembers: totalResults.rows[0].count,
    };

    const usersResults = await db.query('SELECT id, email, image,user_name FROM users');


    res.render('IDV_USR/idv-dashboard.ejs', { metrics, users:req.session.user, });
  } catch (err) {
    console.error('Error fetching data for dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }
});


app.delete('/data/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM data WHERE id = $1', [id]);
    res.redirect('IDV_USR/idv-manage-data');
  } catch (err) {
    console.error('Error deleting data:', err);
    res.status(500).send('Error deleting data');
  }
});

// download database into csv format 

app.get('/download', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM data');
    const rows = result.rows;

    if (rows.length === 0) {
      return res.status(404).send('No data available to download.');
    }

    const fields = Object.keys(rows[0]); // CSV headers from DB columns
    const opts = { fields };
    const parser = new Parser(opts);
    const csv = parser.parse(rows);

    res.header('Content-Type', 'text/csv');
    res.attachment('data_export.csv');
    return res.send(csv);
  } catch (err) {
    console.error('Error exporting data:', err);
    res.status(500).send('Error exporting data');
  }
});

// download database in excel format 
app.get('/download-excel', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM data');
    const rows = result.rows;

    if (rows.length === 0) {
      return res.status(404).send('No data to export.');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Event Data');

    // Add headers from the keys of the first row
    worksheet.columns = Object.keys(rows[0]).map(key => ({
      header: key.toUpperCase(),
      key: key,
      width: 20
    }));

    // Add rows
    rows.forEach(row => {
      worksheet.addRow(row);
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="data_export.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting Excel:', err);
    res.status(500).send('Failed to export Excel file');
  }
});



app.listen(port,()=>{
  console.log(`server runing on port ${port}`)
})